import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

@Injectable()
export class FaqChatRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(FaqChatRateLimitGuard.name);
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly config: ConfigService) {}

  private windowMs(): number {
    const n = parseInt(this.config.get<string>('FAQ_RATE_LIMIT_WINDOW_MS') || '60000', 10);
    return Number.isFinite(n) && n > 0 ? n : 60000;
  }

  private maxHits(): number {
    const n = parseInt(this.config.get<string>('FAQ_RATE_LIMIT_MAX') || '30', 10);
    return Number.isFinite(n) && n > 0 ? Math.min(n, 1000) : 30;
  }

  canActivate(context: ExecutionContext): boolean {
    if (this.config.get<string>('FAQ_RATE_LIMIT_DISABLED')?.trim() === 'true') {
      return true;
    }

    const req = context.switchToHttp().getRequest<Request>();
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket?.remoteAddress ||
      req.ip ||
      'unknown';

    const now = Date.now();
    const windowMs = this.windowMs();
    const max = this.maxHits();

    let arr = this.hits.get(ip) || [];
    arr = arr.filter((t) => now - t < windowMs);
    if (arr.length >= max) {
      this.logger.warn(`FAQ rate limit exceeded for ${ip}`);
      throw new HttpException(
        {
          error: 'Too many FAQ requests. Please wait a moment and try again.',
          retryAfterSec: Math.ceil(windowMs / 1000),
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    arr.push(now);
    this.hits.set(ip, arr);

    if (this.hits.size > 10000) {
      for (const [k, v] of this.hits) {
        if (v.every((t) => now - t >= windowMs)) this.hits.delete(k);
      }
    }

    return true;
  }
}
