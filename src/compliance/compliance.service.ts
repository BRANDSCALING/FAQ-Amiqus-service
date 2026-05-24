import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';
import type { InitAmiqusDto, InitDocuSealDto } from './dto/compliance.dto';

const AMIQUS_BASE = 'https://id.amiqus.co/api/v2';
const PMA_EMAIL = 'admin@allianzhousing.co.uk';
const PMA_NAME = 'Allianz Housing';

/** Amiqus API step types (see Amiqus ID API docs). */
const AMIQUS_STEP_PHOTO_ID = 'check.photo_id';
/** Criminal record step name per Amiqus create-record examples (`check.criminal` is not the documented type). */
const AMIQUS_STEP_CRIMINAL_DEFAULT = 'check.criminal_record';

@Injectable()
export class ComplianceService {
  private readonly logger = new Logger(ComplianceService.name);

  constructor(private readonly config: ConfigService) {}

  private requireAmiqusKey(): string {
    const key = this.config.get<string>('AMIQUS_API_KEY')?.trim();
    if (!key) {
      throw new ServiceUnavailableException('AMIQUS_API_KEY is not configured');
    }
    return key;
  }

  /**
   * Env: false/off → never add DBS step.
   * true/on → add DBS step only if Amiqus lists it on GET /steps (else 502 with available types).
   * auto / unset → add DBS step iff Amiqus lists it (photo-only record otherwise).
   */
  private criminalRecordStepMode(raw: string | undefined): 'off' | 'on' | 'auto' {
    const v = raw?.trim().toLowerCase();
    if (v === 'false' || v === '0' || v === 'no' || v === 'off') return 'off';
    if (v === 'true' || v === '1' || v === 'yes' || v === 'on') return 'on';
    return 'auto';
  }

  /** Parse GET /api/v2/steps response into unique `type` strings (handles paginated_list or raw array). */
  private parseAmiqusStepsPayload(data: unknown): string[] {
    const types = new Set<string>();
    const pushRow = (row: unknown) => {
      if (row && typeof row === 'object' && typeof (row as { type?: unknown }).type === 'string') {
        types.add((row as { type: string }).type);
      }
    };
    if (Array.isArray(data)) {
      for (const row of data) pushRow(row);
      return [...types];
    }
    if (data && typeof data === 'object') {
      const o = data as { data?: unknown; steps?: unknown };
      const arr = Array.isArray(o.data) ? o.data : Array.isArray(o.steps) ? o.steps : [];
      for (const row of arr) pushRow(row);
    }
    return [...types];
  }

  private async amiqusFetchEnabledStepTypes(token: string): Promise<string[]> {
    const res = await axios.get(`${AMIQUS_BASE}/steps`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { limit: 100 },
      validateStatus: () => true,
    });
    if (res.status < 200 || res.status >= 300) {
      this.logger.warn(
        `Amiqus GET /steps failed status=${res.status} body=${JSON.stringify(res.data)?.slice(0, 500)}`,
      );
      return [];
    }
    const types = this.parseAmiqusStepsPayload(res.data);
    this.logger.log(`Amiqus GET /steps ok count=${types.length}`);
    return types;
  }

  /**
   * Operator diagnostic: which step types Amiqus exposes for this API key, and whether DBS would be attached on init.
   */
  async getAmiqusStepsDiagnostic(): Promise<{
    mode: 'off' | 'on' | 'auto';
    configuredCriminalStepType: string;
    enabledStepTypes: string[];
    criminalRecordAvailable: boolean;
    criminalRecordWouldBeIncludedOnInit: boolean;
  }> {
    const token = this.requireAmiqusKey();
    const mode = this.criminalRecordStepMode(this.config.get<string>('AMIQUS_ENABLE_CRIMINAL_RECORD_STEP'));
    const criminalStepTypeConfigured = this.config.get<string>('AMIQUS_DBS_STEP_TYPE')?.trim();
    const configuredCriminalStepType =
      criminalStepTypeConfigured || AMIQUS_STEP_CRIMINAL_DEFAULT;
    const enabledStepTypes = mode === 'off' ? [] : await this.amiqusFetchEnabledStepTypes(token);
    const criminalRecordAvailable = enabledStepTypes.includes(configuredCriminalStepType);
    const criminalRecordWouldBeIncludedOnInit = mode !== 'off' && criminalRecordAvailable;
    return {
      mode,
      configuredCriminalStepType,
      enabledStepTypes,
      criminalRecordAvailable,
      criminalRecordWouldBeIncludedOnInit,
    };
  }

  /**
   * Normalise a per-check status into the four states the frontend renders.
   *
   * Amiqus `check.status` values we've actually seen in prod:
   *   accepted   — check passed (final positive)
   *   rejected   — check failed (final negative)
   *   paused     — user submitted, Amiqus reviewer or background process working
   *   refer      — needs manual review
   *   processing — still running
   *   created    — not started yet
   *   cancelled  — staff cancelled
   *   expired    — deadline passed
   *
   * `completed_at` on the parent step tells us whether the *user* finished
   * their part. For paused/refer/processing we use it to disambiguate
   * "user not done yet" (pending) from "user done, waiting on Amiqus" (submitted).
   */
  private mapAmiqusCheckStatus(args: {
    checkStatus: string | null;
    response: unknown;
    completedAt: string | null;
  }): 'approved' | 'rejected' | 'submitted' | 'in_progress' | 'pending' {
    const s = (args.checkStatus || '').toLowerCase().trim();
    if (s === 'accepted' && args.response === true) return 'approved';
    if (s === 'accepted') return 'approved';
    if (s === 'rejected' || s === 'cancelled' || s === 'canceled' || s === 'expired') {
      return 'rejected';
    }
    // `paused` / `refer` = user finished their part, Amiqus is reviewing.
    if (s === 'paused' || s === 'refer') return 'submitted';
    // step.completed_at being set is the strongest "user submitted" signal.
    if (args.completedAt) return 'submitted';
    // Early-state checks where the user opened the record but hasn't
    // actually submitted any input yet. We want this distinct from
    // 'pending' (= "user never started") so the UI can offer Continue
    // instead of Start.
    if (s === 'pending' || s === 'created' || s === 'processing') return 'in_progress';
    return 'in_progress';
  }

  /**
   * Fetch a record from Amiqus and resolve each step into a per-check
   * summary the rest of the system can consume:
   *
   *   {
   *     recordId,
   *     recordStatus,                    // raw e.g. "paused", "completed"
   *     kyc: { status, response, completedAt, normalized },  // photo_id
   *     dbs: { status, response, completedAt, normalized },  // criminal_record (null if no DBS step on the record)
   *   }
   *
   * `normalized` is one of: 'approved' | 'rejected' | 'submitted' | 'in_progress' | 'pending'.
   * Returns null on the per-check object if Amiqus didn't include that step
   * (e.g. records created before DBS was enabled).
   */
  async getAmiqusRecordCheckSummary(recordId: string): Promise<{
    recordId: number;
    recordStatus: string | null;
    kyc: {
      checkId: number | null;
      status: string | null;
      response: unknown;
      completedAt: string | null;
      normalized: 'approved' | 'rejected' | 'submitted' | 'in_progress' | 'pending';
    } | null;
    dbs: {
      checkId: number | null;
      status: string | null;
      response: unknown;
      completedAt: string | null;
      normalized: 'approved' | 'rejected' | 'submitted' | 'in_progress' | 'pending';
    } | null;
  }> {
    const idStr = String(recordId ?? '').trim();
    if (!idStr || !/^\d+$/.test(idStr)) {
      throw new BadRequestException('recordId must be a positive integer');
    }
    const id = parseInt(idStr, 10);
    const token = this.requireAmiqusKey();
    const headers = { Authorization: `Bearer ${token}` };

    const recRes = await axios.get(`${AMIQUS_BASE}/records/${id}`, {
      headers,
      validateStatus: () => true,
    });
    if (recRes.status < 200 || recRes.status >= 300) {
      this.logger.warn(
        `Amiqus GET /records/${id} failed status=${recRes.status} body=${JSON.stringify(recRes.data)?.slice(0, 500)}`,
      );
      throw new BadGatewayException({
        message: 'Amiqus record lookup failed',
        status: recRes.status,
        details: recRes.data,
      });
    }

    const recordData = recRes.data as {
      status?: unknown;
      steps?: Array<{
        type?: string;
        check?: number;
        completed_at?: string | null;
      }>;
    };
    const recordStatus =
      typeof recordData.status === 'string' ? recordData.status.toLowerCase() : null;
    const steps = Array.isArray(recordData.steps) ? recordData.steps : [];

    const findStep = (type: string) => steps.find((s) => s?.type === type) || null;
    const photoStep = findStep(AMIQUS_STEP_PHOTO_ID);
    const criminalStep = findStep(AMIQUS_STEP_CRIMINAL_DEFAULT);

    const fetchCheck = async (
      stepType: string,
      step: typeof steps[number] | null,
    ) => {
      if (!step || typeof step.check !== 'number') return null;
      const cRes = await axios.get(`${AMIQUS_BASE}/checks/${step.check}`, {
        headers,
        validateStatus: () => true,
      });
      if (cRes.status < 200 || cRes.status >= 300) {
        this.logger.warn(
          `Amiqus GET /checks/${step.check} (${stepType}) failed status=${cRes.status}`,
        );
        return {
          checkId: step.check,
          status: null as string | null,
          response: null,
          completedAt: step.completed_at ?? null,
        };
      }
      const cd = cRes.data as { status?: unknown; response?: unknown };
      return {
        checkId: step.check,
        status: typeof cd.status === 'string' ? cd.status.toLowerCase() : null,
        response: cd.response,
        completedAt: step.completed_at ?? null,
      };
    };

    const [kycRaw, dbsRaw] = await Promise.all([
      fetchCheck(AMIQUS_STEP_PHOTO_ID, photoStep),
      fetchCheck(AMIQUS_STEP_CRIMINAL_DEFAULT, criminalStep),
    ]);

    const kyc = kycRaw
      ? {
          ...kycRaw,
          normalized: this.mapAmiqusCheckStatus({
            checkStatus: kycRaw.status,
            response: kycRaw.response,
            completedAt: kycRaw.completedAt,
          }),
        }
      : null;
    const dbs = dbsRaw
      ? {
          ...dbsRaw,
          normalized: this.mapAmiqusCheckStatus({
            checkStatus: dbsRaw.status,
            response: dbsRaw.response,
            completedAt: dbsRaw.completedAt,
          }),
        }
      : null;

    return { recordId: id, recordStatus, kyc, dbs };
  }

  /**
   * Read-only KYC + DBS status lookup used by the Unified portal to poll
   * whether Amiqus has finished reviewing a record. Splits the answer into
   * per-check statuses (KYC = photo_id, DBS = criminal_record) so the
   * frontend can render them as two badges on a single card.
   *
   * Legacy fields kept for backwards compatibility with older callers:
   *   - `approved` — true when KYC is approved (DBS is reported separately)
   *   - `status`   — the record-level status string (often "paused" even
   *                  after the user has submitted both steps)
   */
  async getAmiqusRecordStatus(recordId: string): Promise<{
    recordId: number;
    status: string | null;
    approved: boolean;
    kycStatus: 'approved' | 'rejected' | 'submitted' | 'in_progress' | 'pending' | null;
    dbsStatus: 'approved' | 'rejected' | 'submitted' | 'in_progress' | 'pending' | null;
    kycCheck: {
      checkId: number | null;
      status: string | null;
      response: unknown;
      completedAt: string | null;
    } | null;
    dbsCheck: {
      checkId: number | null;
      status: string | null;
      response: unknown;
      completedAt: string | null;
    } | null;
  }> {
    try {
      const summary = await this.getAmiqusRecordCheckSummary(recordId);
      const kycStatus = summary.kyc?.normalized ?? null;
      const dbsStatus = summary.dbs?.normalized ?? null;
      return {
        recordId: summary.recordId,
        status: summary.recordStatus,
        approved: kycStatus === 'approved',
        kycStatus,
        dbsStatus,
        kycCheck: summary.kyc
          ? {
              checkId: summary.kyc.checkId,
              status: summary.kyc.status,
              response: summary.kyc.response,
              completedAt: summary.kyc.completedAt,
            }
          : null,
        dbsCheck: summary.dbs
          ? {
              checkId: summary.dbs.checkId,
              status: summary.dbs.status,
              response: summary.dbs.response,
              completedAt: summary.dbs.completedAt,
            }
          : null,
      };
    } catch (e) {
      if (e instanceof BadGatewayException || e instanceof BadRequestException) throw e;
      this.unwrapAxiosError(e, 'Amiqus');
    }
  }

  private requireDocusealConfig(): { apiKey: string; baseUrl: string } {
    const apiKey = this.config.get<string>('DOCUSEAL_API_KEY')?.trim();
    const baseUrl = this.config.get<string>('DOCUSEAL_URL')?.trim()?.replace(/\/$/, '');
    if (!apiKey) {
      throw new ServiceUnavailableException('DOCUSEAL_API_KEY is not configured');
    }
    if (!baseUrl) {
      throw new ServiceUnavailableException('DOCUSEAL_URL is not configured');
    }
    return { apiKey, baseUrl };
  }

  private partnerBackendBaseUrl(): string | null {
    const v = this.config.get<string>('PARTNER_BACKEND_URL')?.trim();
    if (!v) return null;
    return v.replace(/\/$/, '');
  }

  /**
   * Non-blocking mirror to partner backend. Never throws.
   */
  private async postToPartner(path: string, payload: Record<string, unknown>, tag: string): Promise<void> {
    const base = this.partnerBackendBaseUrl();
    if (!base) {
      this.logger.warn(`[PartnerSync:${tag}] PARTNER_BACKEND_URL not configured; skipping`);
      return;
    }

    const url = `${base}${path}`;
    try {
      const res = await axios.post(url, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000,
        validateStatus: () => true,
      });
      if (res.status >= 200 && res.status < 300) {
        this.logger.log(`[PartnerSync:${tag}] ok status=${res.status} url=${url}`);
      } else {
        this.logger.warn(
          `[PartnerSync:${tag}] failed status=${res.status} url=${url} body=${JSON.stringify(res.data).slice(0, 500)}`,
        );
      }
    } catch (e: any) {
      this.logger.warn(`[PartnerSync:${tag}] error url=${url} message=${e?.message}`);
    }
  }

  private templateIdForContract(contractType: 'HSPSLA' | 'TENANTS' | 'SLA'): number {
    // Maps the abstract contractType to the DocuSeal template id via env.
    //   SLA     → SLA_TEMPLATE_ID         (template 4: Allianz_Housing_Complete_Contracts_1
    //                                       — combined HSP + Tenant agreement, the live one)
    //   HSPSLA  → HSPSLA_TEMPLATE_ID      (template 1, legacy standalone HSP SLA)
    //   TENANTS → TENANTS_TEMPLATE_ID     (template 2, legacy standalone Tenants SLA)
    const envKey =
      contractType === 'SLA' ? 'SLA_TEMPLATE_ID'
        : contractType === 'HSPSLA' ? 'HSPSLA_TEMPLATE_ID'
          : 'TENANTS_TEMPLATE_ID';
    const raw = this.config.get<string>(envKey)?.trim();
    const n = parseInt(raw || '', 10);
    if (!Number.isFinite(n) || n <= 0) {
      throw new BadRequestException(`${envKey} must be a positive integer`);
    }
    return n;
  }

  private formatTodayDdMmYyyy(): string {
    const d = new Date();
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const yyyy = String(d.getUTCFullYear());
    return `${dd}/${mm}/${yyyy}`;
  }

  private unwrapAxiosError(e: unknown, provider: string): never {
    if (axios.isAxiosError(e)) {
      const ax = e as AxiosError<unknown>;
      const status = ax.response?.status ?? 502;
      const details = ax.response?.data;
      this.logger.warn(
        `${provider} HTTP error status=${status} message=${ax.message} data=${typeof details === 'object' ? JSON.stringify(details).slice(0, 500) : details}`,
      );
      throw new BadGatewayException({
        message: `${provider} request failed`,
        status,
        details: details ?? ax.message,
      });
    }
    this.logger.error(`${provider} unexpected error: ${(e as Error)?.message}`, (e as Error)?.stack);
    throw new InternalServerErrorException(`${provider} request failed`);
  }

  private parseDocuSealErrorMessage(data: unknown): string {
    if (!data) return '';
    if (typeof data === 'string') return data;
    if (typeof data === 'object') {
      const maybe = (data as { error?: unknown; message?: unknown }).error ?? (data as { message?: unknown }).message;
      if (typeof maybe === 'string') return maybe;
      try {
        return JSON.stringify(data);
      } catch {
        return '';
      }
    }
    return '';
  }

  private isDocuSealUnknownFieldError(data: unknown): boolean {
    const msg = this.parseDocuSealErrorMessage(data).toLowerCase();
    return msg.includes('unknown field');
  }

  /** Photo ID preferences: many teams require `standard` + `docs`; `biometric` is a separate product line in Amiqus. */
  private amiqusPhotoIdPreferences(reportType: string): Record<string, unknown> {
    const t = reportType.trim().toLowerCase();
    if (t === 'biometric') {
      return { report_type: 'biometric' };
    }
    return {
      report_type: 'standard',
      docs: ['passport', 'driving_licence', 'national_id'],
    };
  }

  /**
   * Create Amiqus client, then record (photo ID; optional criminal step); return perform_url.
   */
  async initAmiqus(dto: InitAmiqusDto): Promise<{ performUrl: string; recordId: number; clientId: number }> {
    const token = this.requireAmiqusKey();
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    const mode = this.criminalRecordStepMode(this.config.get<string>('AMIQUS_ENABLE_CRIMINAL_RECORD_STEP'));

    const criminalStepTypeConfigured = this.config.get<string>('AMIQUS_DBS_STEP_TYPE')?.trim();
    const criminalStepType =
      criminalStepTypeConfigured || AMIQUS_STEP_CRIMINAL_DEFAULT;
    const photoReportType =
      this.config.get<string>('AMIQUS_PHOTO_ID_REPORT_TYPE')?.trim() || 'standard';
    const criminalRegion =
      this.config.get<string>('AMIQUS_CRIMINAL_RECORD_REGION')?.trim() || 'england';
    const criminalCheckType =
      this.config.get<string>('AMIQUS_CRIMINAL_RECORD_TYPE')?.trim() || 'standard';
    // Whether the DBS (criminal_record) cost is collected from the end
    // user via Amiqus's built-in payment flow. Default true so a fresh
    // deploy stops billing Brandscaling for every user's £18 DBS check.
    // Set AMIQUS_CRIMINAL_RECORD_ENABLE_PAYMENT=false on the ECS task to
    // revert to "Brandscaling pays" (e.g. for staging / smoke-tests where
    // you don't want a real card prompt). Photo ID (£1) intentionally
    // stays on Brandscaling — we don't want two payment screens in the
    // compliance flow for a £1 step.
    const criminalEnablePaymentRaw = this.config
      .get<string>('AMIQUS_CRIMINAL_RECORD_ENABLE_PAYMENT')
      ?.trim()
      .toLowerCase();
    const criminalEnablePayment =
      criminalEnablePaymentRaw === undefined || criminalEnablePaymentRaw === ''
        ? true
        : criminalEnablePaymentRaw === 'true' ||
          criminalEnablePaymentRaw === '1' ||
          criminalEnablePaymentRaw === 'yes';
    const recordClientMessage = this.config.get<string>('AMIQUS_RECORD_CLIENT_MESSAGE')?.trim();
    const reminderRaw = this.config.get<string>('AMIQUS_RECORD_REMINDER')?.trim().toLowerCase();
    const recordReminder =
      reminderRaw === undefined || reminderRaw === ''
        ? true
        : reminderRaw === 'true' || reminderRaw === '1' || reminderRaw === 'yes';

    let enabledWorkspaceStepTypes: string[] = [];
    if (mode !== 'off') {
      enabledWorkspaceStepTypes = await this.amiqusFetchEnabledStepTypes(token);
    }
    const criminalAvailableOnWorkspace = enabledWorkspaceStepTypes.includes(criminalStepType);

    let includeCriminalStep = false;
    if (mode === 'off') {
      includeCriminalStep = false;
    } else if (mode === 'on') {
      if (!criminalAvailableOnWorkspace) {
        this.logger.warn(
          `Amiqus DBS requested (mode=on) but step type "${criminalStepType}" not in workspace steps: ${enabledWorkspaceStepTypes.join(', ') || '(none)'}`,
        );
        throw new BadGatewayException({
          message: `Amiqus criminal record step is not enabled for this workspace (type "${criminalStepType}"). Enable it in Amiqus or set AMIQUS_ENABLE_CRIMINAL_RECORD_STEP=auto|false.`,
          status: 502,
          details: {
            configuredCriminalStepType: criminalStepType,
            enabledStepTypes: enabledWorkspaceStepTypes,
          },
        });
      }
      includeCriminalStep = true;
    } else {
      includeCriminalStep = criminalAvailableOnWorkspace;
      if (includeCriminalStep) {
        this.logger.log(
          `Amiqus mode=auto: including criminal step "${criminalStepType}" (listed on GET /steps).`,
        );
      } else {
        this.logger.log(
          `Amiqus mode=auto: skipping criminal step — "${criminalStepType}" not in GET /steps (photo ID only).`,
        );
      }
    }

    try {
      const clientRes = await axios.post(
        `${AMIQUS_BASE}/clients`,
        {
          name: {
            title: 'mr',
            first_name: dto.firstName,
            last_name: dto.lastName,
          },
          email: dto.email,
        },
        { headers, validateStatus: () => true },
      );

      if (clientRes.status < 200 || clientRes.status >= 300) {
        this.logger.warn(`Amiqus create client failed: ${clientRes.status} ${JSON.stringify(clientRes.data)}`);
        throw new BadGatewayException({
          message: 'Amiqus create client failed',
          status: clientRes.status,
          details: clientRes.data,
        });
      }

      const clientId = (clientRes.data as { id?: number })?.id;
      if (typeof clientId !== 'number') {
        this.logger.error(`Amiqus client response missing id: ${JSON.stringify(clientRes.data)}`);
        throw new BadGatewayException('Amiqus create client returned an unexpected response');
      }

      const photoStep = {
        type: AMIQUS_STEP_PHOTO_ID,
        preferences: this.amiqusPhotoIdPreferences(photoReportType),
      };

      const steps: Array<Record<string, unknown>> = [photoStep];
      if (includeCriminalStep) {
        const criminalStep =
          criminalStepType === AMIQUS_STEP_CRIMINAL_DEFAULT
            ? {
                type: criminalStepType,
                preferences: {
                  region: criminalRegion,
                  type: criminalCheckType,
                  // `enable_payment: true` → Amiqus collects the £18 DBS
                  // fee from the user via card during the verification
                  // flow instead of billing the Brandscaling workspace.
                  enable_payment: criminalEnablePayment,
                },
              }
            : { type: criminalStepType };
        steps.push(criminalStep);
      }

      const recordBody: Record<string, unknown> = {
        client: clientId,
        steps,
        notification: 'email',
        reminder: recordReminder,
      };
      if (recordClientMessage) {
        recordBody.message = recordClientMessage;
      }

      const recordRes = await axios.post(`${AMIQUS_BASE}/records`, recordBody, {
        headers,
        validateStatus: () => true,
      });

      if (recordRes.status < 200 || recordRes.status >= 300) {
        this.logger.warn(`Amiqus create record failed: ${recordRes.status} ${JSON.stringify(recordRes.data)}`);
        throw new BadGatewayException({
          message: 'Amiqus create record failed',
          status: recordRes.status,
          details: recordRes.data,
        });
      }

      const data = recordRes.data as {
        id?: number;
        perform_url?: string;
      };
      const recordId = data.id;
      const performUrl = data.perform_url;

      if (typeof recordId !== 'number' || typeof performUrl !== 'string' || !performUrl) {
        this.logger.error(`Amiqus record response missing id/perform_url: ${JSON.stringify(recordRes.data)}`);
        throw new BadGatewayException('Amiqus create record returned an unexpected response');
      }

      await this.postToPartner(
        '/api/internal/compliance/link-record',
        {
          email: dto.email,
          amiqus_record_id: String(recordId),
        },
        'amiqus-link-record',
      );

      this.logger.log(`Amiqus record created recordId=${recordId} clientId=${clientId}`);
      return { performUrl, recordId, clientId };
    } catch (e) {
      if (e instanceof BadGatewayException) throw e;
      this.unwrapAxiosError(e, 'Amiqus');
    }
  }

  /**
   * DocuSeal: create submission with two submitters; return HSP embed slug.
   */
  async initDocuSeal(dto: InitDocuSealDto): Promise<{ slug: string; submissionId?: number }> {
    const { apiKey, baseUrl } = this.requireDocusealConfig();
    const templateId = this.templateIdForContract(dto.contractType);
    const today = this.formatTodayDdMmYyyy();

    // IMPORTANT: DocuSeal field names must match template labels exactly.
    // HSPSLA (template 1) and TENANTS (template 2) use different field
    // names. The new SLA combined template (template 4,
    // Allianz_Housing_Complete_Contracts_1) has not had its field labels
    // mapped here yet — we send no prefills and rely on the existing
    // "unknown field" fallback path below to create the submission
    // empty-handed. The user fills everything inside the DocuSeal UI.
    // Once the SLA template's field labels are confirmed, swap [] for an
    // explicit array of { name, default_value } objects.
    const hspFields =
      dto.contractType === 'SLA'
        ? ([] as Array<{ name: string; default_value?: string; preferences?: unknown }>)
        : dto.contractType === 'TENANTS'
          ? [
              { name: 'HSP Financial Contact Name', default_value: dto.hspName },
              { name: 'HSP Financial Contact Address', default_value: dto.registeredAddress },
              { name: 'HSP Financial Contact Email', default_value: dto.hspEmail },
              { name: 'HSP Signatory Name', default_value: dto.hspName },
              {
                name: 'HSP Signatory Date',
                default_value: today,
                preferences: { format: 'DD/MM/YYYY' },
              },
            ]
          : [
              { name: 'Date', default_value: today, preferences: { format: 'DD/MM/YYYY' } },
              { name: 'Company Name', default_value: dto.companyName },
              { name: 'Registered Office Address', default_value: dto.registeredAddress },
              { name: 'Company Reg Number', default_value: dto.companyRegNumber },
              { name: 'HSP Property Address', default_value: dto.registeredAddress },
              { name: 'HSP Director Name', default_value: dto.hspName },
              { name: 'Date', default_value: today, preferences: { format: 'DD/MM/YYYY' } },
            ];

    // PMA submitter prefills: names must match DocuSeal template field labels exactly.
    // Template 1 (HSPSLA) uses Director/Job Title; template 2 (TENANTS) uses Signatory*.
    // Template 4 (SLA combined) — same caveat as hspFields above; no prefills until confirmed.
    const pmaFields =
      dto.contractType === 'SLA'
        ? ([] as Array<{ name: string; default_value?: string; preferences?: unknown }>)
        : dto.contractType === 'HSPSLA'
          ? [
              { name: 'PMA Director Name', default_value: PMA_NAME },
              { name: 'PMA Job Title', default_value: 'Partnering Managing Agent' },
              { name: 'PMA Signatory Date', default_value: today, preferences: { format: 'DD/MM/YYYY' } },
            ]
          : [
              { name: 'PMA Signatory Name', default_value: PMA_NAME },
              { name: 'PMA Signatory Title', default_value: 'Partnering Managing Agent' },
              { name: 'PMA Signatory Date', default_value: today, preferences: { format: 'DD/MM/YYYY' } },
              // Signature fields are completed in the signing UI; do not send default_value here.
            ];

    // Submitter shape differs by template:
    //
    //   SLA (template 4, Allianz_Housing_Complete_Contracts_1) defines a
    //   SINGLE submitter role called "First Party" — the HSP signs alone,
    //   no counter-signature from a PMA. Sending two submitters here makes
    //   DocuSeal accept the call but drop one role, leaving the response
    //   without anything matching role='HSP' downstream.
    //
    //   HSPSLA (template 1) and TENANTS (template 2) are legacy two-party
    //   templates with explicit HSP + PMA roles.
    const payload = {
      template_id: templateId,
      send_email: false,
      submitters:
        dto.contractType === 'SLA'
          ? [
              {
                role: 'First Party',
                email: dto.hspEmail,
                name: dto.hspName,
                send_email: false,
                fields: hspFields,
              },
            ]
          : [
              {
                role: 'HSP',
                email: dto.hspEmail,
                name: dto.hspName,
                send_email: false,
                fields: hspFields,
              },
              {
                role: 'PMA',
                email: PMA_EMAIL,
                name: PMA_NAME,
                send_email: false,
                fields: pmaFields,
              },
            ],
    };

    const url = `${baseUrl}/api/submissions`;

    try {
      const res = await axios.post(url, payload, {
        headers: {
          'Content-Type': 'application/json',
          'X-Auth-Token': apiKey,
        },
        validateStatus: () => true,
      });

      if (res.status < 200 || res.status >= 300) {
        const canFallback = this.isDocuSealUnknownFieldError(res.data);

        if (canFallback) {
          this.logger.warn(
            `DocuSeal ${dto.contractType} prefill field mismatch detected (unknown field). Retrying without prefill fields.`,
          );

          const fallbackPayload = {
            ...payload,
            submitters: payload.submitters.map((s) => ({ ...s, fields: [] as Array<unknown> })),
          };

          const fallbackRes = await axios.post(url, fallbackPayload, {
            headers: {
              'Content-Type': 'application/json',
              'X-Auth-Token': apiKey,
            },
            validateStatus: () => true,
          });

          if (fallbackRes.status >= 200 && fallbackRes.status < 300) {
            const fallbackSubmitters = fallbackRes.data as Array<{
              slug?: string;
              role?: string;
              submission_id?: number;
            }>;
            if (!Array.isArray(fallbackSubmitters)) {
              throw new BadGatewayException('DocuSeal returned an unexpected response');
            }
            // Role-matching strategy depends on contractType (see main path).
            const fallbackHsp =
              dto.contractType === 'SLA'
                ? fallbackSubmitters.find((s) => s.role === 'First Party') || fallbackSubmitters[0]
                : fallbackSubmitters.find((s) => s.role === 'HSP');
            const fallbackSlug = fallbackHsp?.slug;
            if (!fallbackSlug) {
              throw new BadGatewayException('DocuSeal response missing signer submitter slug');
            }
            const fallbackSubmissionId =
              fallbackHsp?.submission_id ?? fallbackSubmitters[0]?.submission_id;
            this.logger.log(
              `DocuSeal fallback submission created templateId=${templateId} slug=${fallbackSlug} submissionId=${fallbackSubmissionId}`,
            );
            if (fallbackSubmissionId != null) {
              const partnerPayload =
                dto.contractType === 'SLA'
                  ? { email: dto.hspEmail, sla_submission_id: String(fallbackSubmissionId) }
                  : dto.contractType === 'HSPSLA'
                    ? { email: dto.hspEmail, hspsla_submission_id: String(fallbackSubmissionId) }
                    : { email: dto.hspEmail, tenants_sla_submission_id: String(fallbackSubmissionId) };
              await this.postToPartner(
                '/api/internal/compliance/link-record',
                partnerPayload,
                'docuseal-link-record-fallback',
              );
            } else {
              this.logger.warn(
                '[PartnerSync:docuseal-link-record-fallback] missing submissionId, skipping partner link',
              );
            }
            return { slug: fallbackSlug, submissionId: fallbackSubmissionId };
          }

          this.logger.warn(
            `DocuSeal fallback failed: ${fallbackRes.status} ${JSON.stringify(fallbackRes.data)}`,
          );
          throw new BadGatewayException({
            message: 'DocuSeal create submission failed',
            status: fallbackRes.status,
            details: fallbackRes.data,
          });
        }

        this.logger.warn(
          `DocuSeal create submission failed: ${res.status} ${JSON.stringify(res.data)}`,
        );
        throw new BadGatewayException({
          message: 'DocuSeal create submission failed',
          status: res.status,
          details: res.data,
        });
      }

      const submitters = res.data as Array<{
        slug?: string;
        role?: string;
        submission_id?: number;
      }>;

      if (!Array.isArray(submitters)) {
        this.logger.error(`DocuSeal unexpected response shape: ${JSON.stringify(res.data).slice(0, 800)}`);
        throw new BadGatewayException('DocuSeal returned an unexpected response');
      }

      // For the SLA template (single role: "First Party") we either find
      // that exact role or fall back to the first (only) submitter.
      // Legacy HSPSLA / TENANTS templates use explicit role 'HSP'.
      const hsp =
        dto.contractType === 'SLA'
          ? submitters.find((s) => s.role === 'First Party') || submitters[0]
          : submitters.find((s) => s.role === 'HSP');
      const slug = hsp?.slug;
      if (!slug) {
        this.logger.error(`DocuSeal no signer submitter slug in: ${JSON.stringify(submitters)}`);
        throw new BadGatewayException('DocuSeal response missing signer submitter slug');
      }

      const submissionId = hsp?.submission_id ?? submitters[0]?.submission_id;
      if (submissionId != null) {
        const partnerPayload =
          dto.contractType === 'SLA'
            ? { email: dto.hspEmail, sla_submission_id: String(submissionId) }
            : dto.contractType === 'HSPSLA'
              ? { email: dto.hspEmail, hspsla_submission_id: String(submissionId) }
              : { email: dto.hspEmail, tenants_sla_submission_id: String(submissionId) };
        await this.postToPartner(
          '/api/internal/compliance/link-record',
          partnerPayload,
          'docuseal-link-record',
        );
      } else {
        this.logger.warn('[PartnerSync:docuseal-link-record] missing submissionId, skipping partner link');
      }
      this.logger.log(`DocuSeal submission created templateId=${templateId} slug=${slug} submissionId=${submissionId}`);
      return { slug, submissionId };
    } catch (e) {
      if (e instanceof BadGatewayException) throw e;
      this.unwrapAxiosError(e, 'DocuSeal');
    }
  }

  /**
   * Resume URL for an Amiqus record — the same `perform_url` Amiqus minted
   * at record creation. Calling `/records/{id}` returns it back: if the
   * record is still active, Amiqus echoes the original URL; once the user
   * has completed every step or the record has expired/been cancelled,
   * Amiqus sets it to `false`.
   *
   * We surface `null` in those terminal cases so the caller can decide
   * what to do (typically: don't show a "Continue" button).
   */
  async getAmiqusResumeUrl(recordId: string): Promise<{
    recordId: number;
    url: string | null;
    recordStatus: string | null;
  }> {
    const idStr = String(recordId ?? '').trim();
    if (!idStr || !/^\d+$/.test(idStr)) {
      throw new BadRequestException('recordId must be a positive integer');
    }
    const id = parseInt(idStr, 10);
    const token = this.requireAmiqusKey();

    const res = await axios.get(`${AMIQUS_BASE}/records/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
      validateStatus: () => true,
    });
    if (res.status < 200 || res.status >= 300) {
      this.logger.warn(
        `Amiqus GET /records/${id} (resume) failed status=${res.status}`,
      );
      throw new BadGatewayException({
        message: 'Amiqus record lookup failed',
        status: res.status,
        details: res.data,
      });
    }
    const data = res.data as { perform_url?: unknown; status?: unknown };
    const url =
      typeof data.perform_url === 'string' && data.perform_url.length > 0
        ? data.perform_url
        : null;
    const recordStatus = typeof data.status === 'string' ? data.status : null;
    return { recordId: id, url, recordStatus };
  }

  /**
   * Resume URL for a DocuSeal submission — the HSP submitter's signing
   * page. Looks up `/api/submissions/{id}`, finds the submitter with
   * `role: 'HSP'`, and rebuilds `${baseUrl}/s/${slug}`.
   *
   * Also returns the live `signed` state of the submitter so the UI can
   * self-correct if the DB hasn't caught up (DocuSeal webhook lag, missed
   * delivery, etc.). `opened` tells the caller whether the user viewed
   * the form at least once — useful for showing "Continue" vs "Start".
   */
  async getDocuSealResumeUrl(submissionId: string): Promise<{
    submissionId: number;
    url: string | null;
    signed: boolean;
    opened: boolean;
    submitterStatus: string | null;
  }> {
    const idStr = String(submissionId ?? '').trim();
    if (!idStr || !/^\d+$/.test(idStr)) {
      throw new BadRequestException('submissionId must be a positive integer');
    }
    const id = parseInt(idStr, 10);
    const { apiKey, baseUrl } = this.requireDocusealConfig();

    const res = await axios.get(`${baseUrl}/api/submissions/${id}`, {
      headers: { 'X-Auth-Token': apiKey, Accept: 'application/json' },
      validateStatus: () => true,
    });
    if (res.status < 200 || res.status >= 300) {
      this.logger.warn(
        `DocuSeal GET /submissions/${id} (resume) failed status=${res.status}`,
      );
      throw new BadGatewayException({
        message: 'DocuSeal submission lookup failed',
        status: res.status,
        details: res.data,
      });
    }

    const data = res.data as {
      submitters?: Array<{
        role?: string;
        slug?: string;
        status?: string;
        completed_at?: string | null;
        opened_at?: string | null;
      }>;
    };
    const submitters = Array.isArray(data.submitters) ? data.submitters : [];
    const hsp =
      submitters.find((s) => String(s?.role || '').toUpperCase() === 'HSP') ||
      submitters[0] ||
      null;

    const slug = hsp?.slug && typeof hsp.slug === 'string' ? hsp.slug : null;
    const url = slug ? `${baseUrl}/s/${slug}` : null;
    const signed = !!hsp?.completed_at;
    const opened = !!hsp?.opened_at || signed;
    const submitterStatus =
      typeof hsp?.status === 'string' ? hsp.status.toLowerCase() : null;

    return { submissionId: id, url, signed, opened, submitterStatus };
  }

  /**
   * Amiqus webhook handler. The webhook fires on any state change — record
   * created, step completed, check accepted/rejected, etc. We don't try to
   * be clever about which event triggered us: any signal is enough to
   * re-fetch the full record from Amiqus and resolve per-check statuses.
   *
   * Forwards `kyc_status` and `dbs_status` to the partner backend as
   * independent fields so the UI can render two badges (Identity check +
   * DBS check) on the single Amiqus card. Sends `status: 'completed'` only
   * as a legacy hint for the (now backwards-compatible) single-column path.
   */
  async handleAmiqusWebhook(body: Record<string, unknown>): Promise<{
    received: boolean;
    recordId?: number;
    status?: string;
    kycStatus?: string | null;
    dbsStatus?: string | null;
  }> {
    const recordId = this.extractAmiqusRecordId(body);
    const status = this.extractAmiqusStatus(body);

    this.logger.log(
      `Amiqus webhook recordId=${recordId ?? 'unknown'} status=${status ?? 'unknown'}`,
    );

    if (recordId == null) {
      this.logger.warn('Amiqus webhook missing recordId; nothing to sync');
      return { received: true, recordId, status };
    }

    let kycStatus: 'approved' | 'rejected' | 'submitted' | 'in_progress' | 'pending' | null = null;
    let dbsStatus: 'approved' | 'rejected' | 'submitted' | 'in_progress' | 'pending' | null = null;
    try {
      const summary = await this.getAmiqusRecordCheckSummary(String(recordId));
      kycStatus = summary.kyc?.normalized ?? null;
      dbsStatus = summary.dbs?.normalized ?? null;
    } catch (e) {
      this.logger.warn(
        `Amiqus webhook recordId=${recordId} check summary fetch failed: ${(e as Error)?.message}`,
      );
    }

    if (kycStatus || dbsStatus) {
      await this.postToPartner(
        '/api/internal/compliance/update-status',
        {
          amiqus_record_id: String(recordId),
          kyc_status: kycStatus,
          dbs_status: dbsStatus,
        },
        'amiqus-webhook-update-status',
      );
    } else if (status?.toLowerCase() === 'completed') {
      // Fallback: we couldn't pull per-check data but the record itself
      // says completed — keep the legacy behaviour as a safety net.
      await this.postToPartner(
        '/api/internal/compliance/update-status',
        {
          amiqus_record_id: String(recordId),
          status: 'completed',
        },
        'amiqus-webhook-update-status-legacy',
      );
    }

    return { received: true, recordId, status, kycStatus, dbsStatus };
  }

  /**
   * DocuSeal webhook: log submission + template; placeholder contract_signed flags.
   */
  async handleDocuSealWebhook(body: Record<string, unknown>): Promise<{
    received: boolean;
    submissionId?: number;
    templateId?: number;
  }> {
    const submissionId = this.extractDocuSealSubmissionId(body);
    const templateId = this.extractDocuSealTemplateId(body);

    this.logger.log(`DocuSeal webhook submissionId=${submissionId ?? 'unknown'} templateId=${templateId ?? 'unknown'}`);

    const looksComplete = this.isDocuSealCompletionPayload(body);
    if (!looksComplete) {
      this.logger.log('DocuSeal webhook ignored for contract placeholder (not a completion event)');
      return { received: true, submissionId, templateId };
    }

    if (submissionId != null && templateId != null) {
      await this.postToPartner(
        '/api/internal/compliance/update-status',
        {
          submission_id: submissionId,
          template_id: templateId,
        },
        'docuseal-webhook-update-status',
      );
    }

    return { received: true, submissionId, templateId };
  }

  /** Heuristic: DocuSeal webhook shapes vary; treat obvious completion signals as signed. */
  private isDocuSealCompletionPayload(body: Record<string, unknown>): boolean {
    const ev = String(body.event_type ?? body.event ?? body.type ?? '').toLowerCase();
    if (ev.includes('complete') || ev.includes('completed') || ev.includes('submission.completed')) {
      return true;
    }
    const sub = body.submission as Record<string, unknown> | undefined;
    if (sub && String(sub.status ?? '').toLowerCase() === 'completed') {
      return true;
    }
    if (String(body.status ?? '').toLowerCase() === 'completed') {
      return true;
    }
    const data = body.data as Record<string, unknown> | undefined;
    if (data) {
      const inner = data.submission as Record<string, unknown> | undefined;
      if (inner && String(inner.status ?? '').toLowerCase() === 'completed') return true;
      const iev = String(data.event_type ?? data.event ?? '').toLowerCase();
      if (iev.includes('complete')) return true;
    }
    return false;
  }

  private parseEnvTemplateId(
    key: 'HSPSLA_TEMPLATE_ID' | 'TENANTS_TEMPLATE_ID' | 'SLA_TEMPLATE_ID',
  ): number | undefined {
    const raw = this.config.get<string>(key)?.trim();
    const n = parseInt(raw || '', 10);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }

  private extractAmiqusRecordId(body: Record<string, unknown>): number | undefined {
    const direct = body.id;
    if (typeof direct === 'number') return direct;
    if (typeof direct === 'string' && /^\d+$/.test(direct)) return parseInt(direct, 10);

    const record = body.record as Record<string, unknown> | undefined;
    if (record && typeof record.id === 'number') return record.id;
    if (record && typeof record.id === 'string' && /^\d+$/.test(record.id)) return parseInt(record.id, 10);

    const data = body.data as Record<string, unknown> | undefined;
    if (data) {
      if (typeof data.record_id === 'number') return data.record_id;
      if (typeof data.id === 'number') return data.id;
      const inner = data.record as Record<string, unknown> | undefined;
      if (inner && typeof inner.id === 'number') return inner.id;
    }
    return undefined;
  }

  private extractAmiqusStatus(body: Record<string, unknown>): string | undefined {
    if (typeof body.status === 'string') return body.status;
    const record = body.record as Record<string, unknown> | undefined;
    if (record && typeof record.status === 'string') return record.status;
    const data = body.data as Record<string, unknown> | undefined;
    if (data && typeof data.status === 'string') return data.status;
    return undefined;
  }

  private extractDocuSealSubmissionId(body: Record<string, unknown>): number | undefined {
    const sub = body.submission as Record<string, unknown> | undefined;
    if (sub && typeof sub.id === 'number') return sub.id;
    if (typeof body.submission_id === 'number') return body.submission_id;
    const data = body.data as Record<string, unknown> | undefined;
    if (data) {
      const inner = data.submission as Record<string, unknown> | undefined;
      if (inner && typeof inner.id === 'number') return inner.id;
      if (typeof data.submission_id === 'number') return data.submission_id;
    }
    return undefined;
  }

  private extractDocuSealTemplateId(body: Record<string, unknown>): number | undefined {
    // Flat shapes
    if (typeof body.template_id === 'number') return body.template_id;
    const topTpl = body.template as Record<string, unknown> | undefined;
    if (topTpl && typeof topTpl.id === 'number') return topTpl.id;

    // Under body.submission (some DocuSeal shapes)
    const sub = body.submission as Record<string, unknown> | undefined;
    if (sub) {
      if (typeof sub.template_id === 'number') return sub.template_id;
      const subTpl = sub.template as Record<string, unknown> | undefined;
      if (subTpl && typeof subTpl.id === 'number') return subTpl.id;
    }

    // Under body.data (form.completed / submission.completed wrap the payload here)
    const data = body.data as Record<string, unknown> | undefined;
    if (data) {
      if (typeof data.template_id === 'number') return data.template_id;
      const dataTpl = data.template as Record<string, unknown> | undefined;
      if (dataTpl && typeof dataTpl.id === 'number') return dataTpl.id;
      const inner = data.submission as Record<string, unknown> | undefined;
      if (inner) {
        if (typeof inner.template_id === 'number') return inner.template_id;
        const innerTpl = inner.template as Record<string, unknown> | undefined;
        if (innerTpl && typeof innerTpl.id === 'number') return innerTpl.id;
      }
    }

    return undefined;
  }

}
