import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError, AxiosRequestConfig } from 'axios';

/**
 * Amiqus admin operations that require workspace-admin privileges — listing
 * the global queue of pending name-change corrections, approving them,
 * rejecting them.
 *
 * Auth model: the static `AMIQUS_API_KEY` we use for the regular check-flow
 * has scopes=[] and is restricted to per-record operations (it works for
 * `GET /records/{id}`, fails on `GET /records?...` etc). For admin
 * operations we instead use an OAuth2 access token minted via the
 * authorization-code flow as the workspace owner (Fariza Javed). That
 * token's `sub` is her user id, so she inherits her account permissions
 * end-to-end through the API.
 *
 * Token credentials live in Secrets Manager and are injected via these env
 * vars at container start:
 *   AMIQUS_OAUTH_CLIENT_ID
 *   AMIQUS_OAUTH_CLIENT_SECRET
 *   AMIQUS_OAUTH_ACCESS_TOKEN
 *   AMIQUS_OAUTH_REFRESH_TOKEN
 *
 * On 401 from Amiqus we attempt a one-shot refresh using the refresh_token
 * grant. The new tokens stay in-memory only — the live ECS task keeps
 * them in its process lifetime. We don't write back to Secrets Manager
 * (would need write IAM permission on the secrets); instead we log a
 * loud warning when the refresh happens so the operator knows to update
 * Secrets Manager manually next time the container restarts. The access
 * token is valid for a year out of the box so this is rare.
 */

const AMIQUS_BASE = 'https://id.amiqus.co/api/v2';
const AMIQUS_TOKEN_URL = 'https://id.amiqus.co/oauth/token';
const AMIQUS_RECORD_URL_PATTERN = 'https://id.amiqus.co/records/{id}';

@Injectable()
export class AmiqusAdminService {
  private readonly logger = new Logger(AmiqusAdminService.name);
  /** In-memory cache of the current access token. Overwritten on refresh. */
  private accessToken: string | null = null;
  /** Mirror of the refresh token in memory; rotated whenever we refresh. */
  private refreshToken: string | null = null;
  /** Single-flight latch so concurrent 401s only trigger one refresh. */
  private refreshInFlight: Promise<void> | null = null;

  constructor(private readonly config: ConfigService) {
    this.accessToken = this.config.get<string>('AMIQUS_OAUTH_ACCESS_TOKEN')?.trim() || null;
    this.refreshToken = this.config.get<string>('AMIQUS_OAUTH_REFRESH_TOKEN')?.trim() || null;
  }

  /** True once the OAuth credentials are populated. */
  private get configured(): boolean {
    return !!(
      this.accessToken &&
      this.config.get<string>('AMIQUS_OAUTH_CLIENT_ID') &&
      this.config.get<string>('AMIQUS_OAUTH_CLIENT_SECRET')
    );
  }

  private requireConfigured(): void {
    if (!this.configured) {
      throw new ServiceUnavailableException(
        'Amiqus admin OAuth credentials are not configured. Set AMIQUS_OAUTH_* env vars (see Secrets Manager).',
      );
    }
  }

  /**
   * Refresh the access token using the refresh_token grant. Single-flight so
   * a burst of concurrent 401s doesn't trigger N refreshes.
   */
  private async refreshAccessToken(): Promise<void> {
    if (this.refreshInFlight) return this.refreshInFlight;
    if (!this.refreshToken) {
      throw new ServiceUnavailableException('Cannot refresh — AMIQUS_OAUTH_REFRESH_TOKEN missing.');
    }
    this.refreshInFlight = (async () => {
      try {
        this.logger.warn('Amiqus access token expired/invalid — refreshing via refresh_token grant.');
        const res = await axios.post(
          AMIQUS_TOKEN_URL,
          new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: this.refreshToken!,
            client_id: this.config.get<string>('AMIQUS_OAUTH_CLIENT_ID')!,
            client_secret: this.config.get<string>('AMIQUS_OAUTH_CLIENT_SECRET')!,
          }).toString(),
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              Accept: 'application/json',
            },
            validateStatus: () => true,
          },
        );
        if (res.status < 200 || res.status >= 300) {
          throw new BadGatewayException({
            message: 'Amiqus token refresh failed',
            status: res.status,
            details: res.data,
          });
        }
        const data = res.data as { access_token?: string; refresh_token?: string };
        if (!data.access_token) {
          throw new BadGatewayException('Amiqus token refresh returned no access_token');
        }
        this.accessToken = data.access_token;
        if (data.refresh_token) this.refreshToken = data.refresh_token;
        this.logger.warn(
          'Amiqus tokens refreshed successfully. NOTE: the live container memory has the new tokens, but the AWS Secrets Manager copies are now stale — update them when convenient (see scripts/amiqus-rotate-oauth-tokens.mjs if it exists).',
        );
      } finally {
        this.refreshInFlight = null;
      }
    })();
    return this.refreshInFlight;
  }

  /**
   * Issue a request to Amiqus with the OAuth access token. On 401 we
   * refresh and retry exactly once.
   */
  private async amiqusRequest<T>(config: AxiosRequestConfig): Promise<T> {
    this.requireConfigured();
    const send = async () =>
      axios.request<T>({
        baseURL: AMIQUS_BASE,
        ...config,
        headers: {
          ...(config.headers || {}),
          Authorization: `Bearer ${this.accessToken}`,
          Accept: 'application/json',
        },
        validateStatus: () => true,
      });
    let res = await send();
    if (res.status === 401) {
      await this.refreshAccessToken();
      res = await send();
    }
    if (res.status < 200 || res.status >= 300) {
      this.logger.warn(
        `Amiqus admin ${config.method || 'GET'} ${config.url} failed: ${res.status} ${JSON.stringify(res.data)?.slice(0, 500)}`,
      );
      throw new BadGatewayException({
        message: 'Amiqus admin request failed',
        status: res.status,
        details: res.data,
      });
    }
    return res.data;
  }

  /**
   * List every Amiqus record currently in `amendments` status, then for
   * each one pull the client's pending corrections. Flatten into a single
   * array the admin portal can render directly.
   */
  async listPendingCorrections(): Promise<{
    corrections: Array<{
      correctionId: number;
      clientId: number;
      recordId: number;
      email: string | null;
      currentName: {
        title: string | null;
        firstName: string | null;
        middleName: string | null;
        lastName: string | null;
        fullName: string | null;
      };
      proposedName: {
        firstName: string | null;
        middleName: string | null;
        lastName: string | null;
      };
      createdAt: string | null;
      amiqusRecordUrl: string;
    }>;
    count: number;
  }> {
    this.requireConfigured();

    // 1. Pull every record currently in amendments status.
    const records = await this.amiqusRequest<{
      data?: Array<{
        id?: number;
        client?: number;
        email?: string;
        name?: {
          title?: string;
          first_name?: string;
          middle_name?: string;
          last_name?: string;
          complete_name?: string;
        };
      }>;
    }>({ method: 'GET', url: '/records?status=amendments&limit=100' });

    const items = Array.isArray(records.data) ? records.data : [];

    // 2. For each record, pull the client's corrections. We could parallelise
    //    this but the admin queue tends to be small (<100) so sequential
    //    keeps log lines readable and avoids burst-limit issues.
    const out: Array<any> = [];
    for (const r of items) {
      if (!r.id || !r.client) continue;
      try {
        const corr = await this.amiqusRequest<{
          data?: Array<{
            id?: number;
            client?: number;
            record?: number;
            status?: string;
            correction?: {
              first_name?: string;
              middle_name?: string;
              last_name?: string;
            };
            created_at?: string;
          }>;
        }>({ method: 'GET', url: `/clients/${r.client}/corrections` });
        for (const c of corr.data || []) {
          if (!c.id || c.status !== 'pending') continue;
          out.push({
            correctionId: c.id,
            clientId: r.client,
            recordId: r.id,
            email: r.email || null,
            currentName: {
              title: r.name?.title || null,
              firstName: r.name?.first_name || null,
              middleName: r.name?.middle_name || null,
              lastName: r.name?.last_name || null,
              fullName: r.name?.complete_name || null,
            },
            proposedName: {
              firstName: c.correction?.first_name || null,
              middleName: c.correction?.middle_name || null,
              lastName: c.correction?.last_name || null,
            },
            createdAt: c.created_at || null,
            amiqusRecordUrl: AMIQUS_RECORD_URL_PATTERN.replace('{id}', String(r.id)),
          });
        }
      } catch (e) {
        this.logger.warn(
          `Failed to fetch corrections for client ${r.client} (record ${r.id}): ${(e as Error)?.message}`,
        );
      }
    }
    return { corrections: out, count: out.length };
  }

  /** Approve a single name-change correction. */
  async approveCorrection(
    clientId: number,
    correctionId: number,
  ): Promise<{ correctionId: number; status: string }> {
    return this.patchCorrection(clientId, correctionId, 'accepted');
  }

  /** Reject a single name-change correction. */
  async rejectCorrection(
    clientId: number,
    correctionId: number,
  ): Promise<{ correctionId: number; status: string }> {
    return this.patchCorrection(clientId, correctionId, 'rejected');
  }

  private async patchCorrection(
    clientId: number,
    correctionId: number,
    status: 'accepted' | 'rejected',
  ): Promise<{ correctionId: number; status: string }> {
    if (!Number.isFinite(clientId) || clientId <= 0) {
      throw new BadRequestException('clientId must be a positive integer');
    }
    if (!Number.isFinite(correctionId) || correctionId <= 0) {
      throw new BadRequestException('correctionId must be a positive integer');
    }
    const res = await this.amiqusRequest<{
      id?: number;
      status?: string;
    }>({
      method: 'PATCH',
      url: `/clients/${clientId}/corrections/${correctionId}`,
      data: { status },
      headers: { 'Content-Type': 'application/json' },
    });
    return {
      correctionId: res.id ?? correctionId,
      status: res.status ?? status,
    };
  }
}
