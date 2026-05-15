import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { FaqRetrievalService } from './faq-retrieval.service';
import { parseQuestionsMarkdownSections } from './faq-questions-parser';
import type { FaqEntry } from './types/faq-knowledge.types';

function loadSectionFaqs(): FaqEntry[] {
  const candidates = [
    join(process.cwd(), 'faq-chatbot-knowledge', 'questions.md'),
    join(process.cwd(), 'faq-amiqus-service', 'faq-chatbot-knowledge', 'questions.md'),
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    const sections = parseQuestionsMarkdownSections(readFileSync(p, 'utf-8'));
    return sections.map((s) => ({
      id: s.id,
      category: `Section ${s.sectionNumber}: ${s.title}`,
      question: s.headingLine,
      answer: s.bodyMarkdown,
    }));
  }
  throw new Error('questions.md not found for tests (run from faq-amiqus-service/ or repo root)');
}

describe('FaqRetrievalService', () => {
  let service: FaqRetrievalService;
  let faqs: FaqEntry[];

  beforeEach(async () => {
    faqs = loadSectionFaqs();
    const moduleRef = await Test.createTestingModule({
      providers: [
        FaqRetrievalService,
        { provide: ConfigService, useValue: { get: () => undefined } },
      ],
    }).compile();
    service = moduleRef.get(FaqRetrievalService);
  });

  it('returns topK items for nonsense query', () => {
    const r = service.retrieve('???', faqs, 3);
    expect(r).toHaveLength(Math.min(3, faqs.length));
  });

  it('ranks exempt accommodation / legal toward section 1', () => {
    const r = service.retrieve('What is exempt accommodation loophole legislation', faqs, 8);
    expect(r[0]?.stableId).toBe('ucws-section-1');
  });

  it('ranks LHA / benefit cap toward section 2', () => {
    const r = service.retrieve('benefit cap exempt accommodation LHA rates', faqs, 8);
    const ids = r.map((x) => x.stableId);
    expect(ids).toContain('ucws-section-2');
    expect(ids[0]).toBe('ucws-section-2');
  });

  it('handles multi-topic message', () => {
    const r = service.retrieve('Article 4 void periods payment flow DWP', faqs, 4);
    expect(r).toHaveLength(4);
    const ids = new Set(r.map((x) => x.stableId));
    expect(ids.size).toBe(4);
  });
});
