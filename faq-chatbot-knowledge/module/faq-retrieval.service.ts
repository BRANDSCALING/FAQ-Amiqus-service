import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FaqEntry } from './types/faq-knowledge.types';

const STOP = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
  'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall',
  'can', 'need', 'dare', 'ought', 'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by',
  'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between',
  'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how',
  'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor',
  'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'and', 'but', 'if', 'or',
  'because', 'until', 'while', 'about', 'against', 'between', 'into', 'through', 'this', 'that',
  'these', 'those', 'i', 'me', 'my', 'we', 'our', 'you', 'your', 'it', 'its', 'they', 'their',
  'what', 'which', 'who', 'whom', 'am', 'is', 'are', 'was', 'were', 'been', 'being',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((w) => w.length > 1 && !STOP.has(w));
}

function uniqueTokens(texts: string[]): Set<string> {
  const s = new Set<string>();
  for (const t of texts) {
    for (const w of tokenize(t)) s.add(w);
  }
  return s;
}

export interface ScoredFaq {
  entry: FaqEntry;
  stableId: string;
  score: number;
}

@Injectable()
export class FaqRetrievalService {
  constructor(private readonly config: ConfigService) {}

  /** Score FAQs by token overlap with user message + question + answer; return top K. */
  retrieve(userMessage: string, faqs: FaqEntry[], topK: number): ScoredFaq[] {
    const userTokens = uniqueTokens([userMessage]);
    if (userTokens.size === 0) {
      return faqs.slice(0, topK).map((entry, i) => ({
        entry,
        stableId: entry.id?.trim() || `idx-${i}`,
        score: 0,
      }));
    }

    const scored: ScoredFaq[] = faqs.map((entry, i) => {
      const stableId = entry.id?.trim() || `idx-${i}`;
      const blob = `${entry.question} ${entry.answer}`;
      const faqTokens = tokenize(blob);
      let score = 0;
      const seen = new Set<string>();
      for (const w of faqTokens) {
        if (userTokens.has(w) && !seen.has(w)) {
          seen.add(w);
          score += 1;
        }
      }
      return { entry, stableId, score };
    });

    scored.sort((a, b) => b.score - a.score);
    const maxScore = scored[0]?.score ?? 0;
    const k = Math.max(1, topK);

    if (maxScore === 0) {
      return faqs.slice(0, Math.min(k, faqs.length)).map((entry, i) => ({
        entry,
        stableId: entry.id?.trim() || `idx-${i}`,
        score: 0,
      }));
    }

    const top = scored.filter((s) => s.score > 0).slice(0, k);
    if (top.length >= k) return top;
    const ids = new Set(top.map((t) => t.stableId));
    for (const s of scored) {
      if (top.length >= k) break;
      if (!ids.has(s.stableId)) {
        top.push(s);
        ids.add(s.stableId);
      }
    }
    return top.slice(0, k);
  }

  getTopK(): number {
    const n = parseInt(this.config.get<string>('FAQ_RETRIEVAL_TOP_K') || '8', 10);
    return Number.isFinite(n) && n > 0 ? Math.min(n, 30) : 8;
  }
}
