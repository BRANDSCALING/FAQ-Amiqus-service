import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { parseQuestionsMarkdownSections } from './faq-questions-parser';

function loadQuestionsMd(): string {
  const candidates = [
    join(process.cwd(), 'faq-chatbot-knowledge', 'questions.md'),
    join(process.cwd(), 'faq-amiqus-service', 'faq-chatbot-knowledge', 'questions.md'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return readFileSync(p, 'utf-8');
  }
  throw new Error('questions.md not found (run tests from faq-amiqus-service/ or repo root)');
}

describe('parseQuestionsMarkdownSections', () => {
  it('extracts exactly 7 section chunks with stable ids', () => {
    const raw = loadQuestionsMd();
    const sections = parseQuestionsMarkdownSections(raw);
    expect(sections.length).toBe(7);
    expect(sections.map((s) => s.id)).toEqual([
      'ucws-section-1',
      'ucws-section-2',
      'ucws-section-3',
      'ucws-section-4',
      'ucws-section-5',
      'ucws-section-6',
      'ucws-section-7',
    ]);
  });

  it('includes Q1 in section 1 body and Q30 in section 7 body', () => {
    const raw = loadQuestionsMd();
    const sections = parseQuestionsMarkdownSections(raw);
    const s1 = sections.find((s) => s.sectionNumber === 1);
    const s7 = sections.find((s) => s.sectionNumber === 7);
    expect(s1?.bodyMarkdown).toMatch(/Q1\./);
    expect(s7?.bodyMarkdown).toMatch(/Q30\./);
  });
});
