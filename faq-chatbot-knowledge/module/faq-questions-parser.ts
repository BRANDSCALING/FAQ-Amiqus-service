/**
 * Parse `questions.md` into one RAG chunk per **SECTION N:** block (semantic unit).
 * Email intro/outro (before Section 1 / after Section 7) is excluded — only the seven FAQ sections are indexed.
 */
export interface ParsedFaqSection {
  /** Stable citation id, e.g. ucws-section-1 */
  id: string;
  sectionNumber: number;
  /** Title text after "SECTION N:" (trimmed, without markdown stars). */
  title: string;
  /** First line only, e.g. **SECTION 1: THE LEGAL FRAMEWORK** */
  headingLine: string;
  /** All lines after the heading (Q&A body). */
  bodyMarkdown: string;
  /** Full section text for embedding and prompts (heading + body). */
  fullText: string;
}

const SECTION_HEAD = /^\*\*SECTION (\d+):\s*([^*]+)\*\*\s*/;

export function parseQuestionsMarkdownSections(raw: string): ParsedFaqSection[] {
  const normalized = raw.replace(/\r\n/g, '\n');
  const parts = normalized.split(/(?=\*\*SECTION \d+:)/);
  const sections: ParsedFaqSection[] = [];

  for (const part of parts) {
    const trimmed = part.trim();
    if (!/^\*\*SECTION \d+:/.test(trimmed)) continue;

    const m = trimmed.match(SECTION_HEAD);
    if (!m) continue;

    const sectionNumber = parseInt(m[1], 10);
    if (!Number.isFinite(sectionNumber) || sectionNumber < 1) continue;

    const title = m[2].trim();
    const headingLine = m[0].trim();
    const bodyMarkdown = trimmed.slice(m[0].length).trim();
    const fullText = `${headingLine}\n\n${bodyMarkdown}`.trim();

    sections.push({
      id: `ucws-section-${sectionNumber}`,
      sectionNumber,
      title,
      headingLine,
      bodyMarkdown,
      fullText,
    });
  }

  sections.sort((a, b) => a.sectionNumber - b.sectionNumber);
  return sections;
}
