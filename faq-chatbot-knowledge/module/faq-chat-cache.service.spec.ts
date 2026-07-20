import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { FaqChatCacheService } from './faq-chat-cache.service';

describe('FaqChatCacheService', () => {
  async function createService(config: Record<string, string | undefined>) {
    const moduleRef = await Test.createTestingModule({
      providers: [
        FaqChatCacheService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => config[key],
          },
        },
      ],
    }).compile();
    return moduleRef.get(FaqChatCacheService);
  }

  it('uses same cache key for different spacing and case (normalized message)', async () => {
    const svc = await createService({
      FAQ_CACHE_DISABLED: undefined,
      FAQ_CACHE_TTL_SEC: '60',
    });
    const v = '1';
    expect(svc.key(v, '  Hello   WORLD  ')).toBe(svc.key(v, 'hello world'));
  });

  it('uses different keys for different knowledge versions', async () => {
    const svc = await createService({ FAQ_CACHE_TTL_SEC: '60' });
    expect(svc.key('1', 'same')).not.toBe(svc.key('2', 'same'));
  });

  it('get returns null when cache disabled', async () => {
    const svc = await createService({
      FAQ_CACHE_DISABLED: 'true',
      FAQ_CACHE_TTL_SEC: '60',
    });
    svc.set('1', 'hello', { x: 1 });
    expect(svc.get('1', 'hello')).toBeNull();
  });

  it('set and get roundtrip when enabled', async () => {
    const svc = await createService({ FAQ_CACHE_TTL_SEC: '60' });
    const payload = { response: 'ok', outOfScope: false, citedFaqIds: [] };
    svc.set('1', 'What are credits?', payload);
    expect(svc.get('1', 'What are credits?')).toEqual(payload);
    expect(svc.get('1', 'what  are   credits?')).toEqual(payload);
  });
});
