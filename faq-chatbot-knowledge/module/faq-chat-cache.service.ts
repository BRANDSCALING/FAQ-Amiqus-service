import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

@Injectable()
export class FaqChatCacheService {
  private readonly logger = new Logger(FaqChatCacheService.name);
  private readonly store = new Map<string, CacheEntry>();

  constructor(private readonly config: ConfigService) {}

  private ttlMs(): number {
    const sec = parseInt(this.config.get<string>('FAQ_CACHE_TTL_SEC') || '120', 10);
    return Math.max(0, Number.isFinite(sec) ? sec * 1000 : 120000);
  }

  private maxEntries(): number {
    const n = parseInt(this.config.get<string>('FAQ_CACHE_MAX') || '500', 10);
    return Number.isFinite(n) && n > 0 ? Math.min(n, 5000) : 500;
  }

  isEnabled(): boolean {
    return this.config.get<string>('FAQ_CACHE_DISABLED')?.trim() !== 'true';
  }

  key(knowledgeVersion: string, message: string): string {
    const norm = message.trim().toLowerCase().replace(/\s+/g, ' ');
    const h = createHash('sha256').update(`${knowledgeVersion}::${norm}`).digest('hex');
    return h;
  }

  get<T>(knowledgeVersion: string, message: string): T | null {
    if (!this.isEnabled()) return null;
    const k = this.key(knowledgeVersion, message);
    const e = this.store.get(k);
    if (!e) return null;
    if (Date.now() > e.expiresAt) {
      this.store.delete(k);
      return null;
    }
    return e.value as T;
  }

  set(knowledgeVersion: string, message: string, value: unknown): void {
    if (!this.isEnabled()) return;
    const ttl = this.ttlMs();
    if (ttl <= 0) return;
    const max = this.maxEntries();
    if (this.store.size >= max) {
      const first = this.store.keys().next().value;
      if (first) this.store.delete(first);
    }
    const k = this.key(knowledgeVersion, message);
    this.store.set(k, { value, expiresAt: Date.now() + ttl });
  }
}
