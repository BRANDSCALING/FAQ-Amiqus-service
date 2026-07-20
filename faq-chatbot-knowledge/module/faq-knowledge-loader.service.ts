import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { parseQuestionsMarkdownSections } from './faq-questions-parser';
import type { FaqEntry, FaqKnowledgeFile } from './types/faq-knowledge.types';

@Injectable()
export class FaqKnowledgeLoaderService implements OnModuleInit {
  private readonly logger = new Logger(FaqKnowledgeLoaderService.name);
  private knowledge: FaqKnowledgeFile | null = null;
  private loadedMetaPath: string | null = null;
  private loadedQuestionsPath: string | null = null;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    this.reload();
  }

  /** Optional: directory containing faq-meta.json + questions.md, or path to faq-meta.json */
  resolveMetaPath(): string {
    const fromEnv = this.config.get<string>('FAQ_KNOWLEDGE_PATH')?.trim();
    if (fromEnv) {
      const abs = resolve(fromEnv);
      if (existsSync(abs) && !abs.endsWith('.json')) {
        return join(abs, 'faq-meta.json');
      }
      if (abs.endsWith('.json')) return abs;
      return join(abs, 'faq-meta.json');
    }

    const candidates = [
      join(process.cwd(), 'faq-chatbot-knowledge', 'faq-meta.json'),
      join(process.cwd(), 'faq-amiqus-service', 'faq-chatbot-knowledge', 'faq-meta.json'),
      join(process.cwd(), 'dist', 'faq-chatbot-knowledge', 'faq-meta.json'),
    ];
    for (const p of candidates) {
      if (existsSync(p)) return p;
    }
    return candidates[0];
  }

  resolveQuestionsPath(metaPath: string): string {
    const fromEnv = this.config.get<string>('FAQ_QUESTIONS_PATH')?.trim();
    if (fromEnv) return resolve(fromEnv);

    const base = dirname(metaPath);
    const p = join(base, 'questions.md');
    if (existsSync(p)) return p;

    const candidates = [
      join(process.cwd(), 'faq-chatbot-knowledge', 'questions.md'),
      join(process.cwd(), 'faq-amiqus-service', 'faq-chatbot-knowledge', 'questions.md'),
      join(process.cwd(), 'dist', 'faq-chatbot-knowledge', 'questions.md'),
    ];
    for (const c of candidates) {
      if (existsSync(c)) return c;
    }
    return join(base, 'questions.md');
  }

  reload(): void {
    const metaPath = this.resolveMetaPath();
    this.loadedMetaPath = metaPath;

    if (!existsSync(metaPath)) {
      this.logger.error(`FAQ meta file not found: ${metaPath}`);
      this.knowledge = emptyKnowledge('No faq-meta.json loaded.');
      return;
    }

    let meta: { version?: string; chatbotTitle?: string; scopeDescription?: string };
    try {
      meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
    } catch (e: any) {
      this.logger.error(`Failed to read faq-meta.json: ${e?.message}`);
      this.knowledge = emptyKnowledge('faq-meta.json invalid.');
      return;
    }

    if (!meta.chatbotTitle?.trim() || !meta.scopeDescription?.trim()) {
      this.logger.error('faq-meta.json must include chatbotTitle and scopeDescription');
      this.knowledge = emptyKnowledge('faq-meta.json missing title or scope.');
      return;
    }

    const questionsPath = this.resolveQuestionsPath(metaPath);
    this.loadedQuestionsPath = questionsPath;

    if (!existsSync(questionsPath)) {
      this.logger.error(`questions.md not found: ${questionsPath}`);
      this.knowledge = {
        version: meta.version?.trim() || '0',
        chatbotTitle: meta.chatbotTitle.trim(),
        scopeDescription: meta.scopeDescription.trim(),
        faqs: [],
      };
      return;
    }

    try {
      const rawMd = readFileSync(questionsPath, 'utf-8');
      const sections = parseQuestionsMarkdownSections(rawMd);
      if (sections.length !== 20) {
        this.logger.warn(
          `Expected 20 SECTION chunks from questions.md, got ${sections.length}. Check **SECTION N:** headings.`,
        );
      }

      const faqs: FaqEntry[] = sections.map((s) => ({
        id: s.id,
        category: `Section ${s.sectionNumber}: ${s.title}`,
        question: s.headingLine,
        answer: s.bodyMarkdown,
      }));

      this.knowledge = {
        version: meta.version?.trim() || '1',
        chatbotTitle: meta.chatbotTitle.trim(),
        scopeDescription: meta.scopeDescription.trim(),
        faqs,
      };
      this.logger.log(
        `Loaded UCWS FAQ: ${faqs.length} section chunks from ${questionsPath} (meta v${this.knowledge.version} @ ${metaPath})`,
      );
    } catch (e: any) {
      this.logger.error(`Failed to parse questions.md: ${e?.message}`);
      this.knowledge = {
        version: meta.version?.trim() || '0',
        chatbotTitle: meta.chatbotTitle.trim(),
        scopeDescription: meta.scopeDescription.trim(),
        faqs: [],
      };
    }
  }

  getKnowledge(): FaqKnowledgeFile {
    return (
      this.knowledge || {
        version: '0',
        chatbotTitle: 'FAQ Assistant',
        scopeDescription: 'No knowledge loaded.',
        faqs: [],
      }
    );
  }

  /** Primary knowledge file for logging (faq-meta.json). */
  getLoadedPath(): string | null {
    return this.loadedMetaPath;
  }

  getQuestionsPath(): string | null {
    return this.loadedQuestionsPath;
  }

  /** Plain-text block (all sections) — not used by RAG path but kept for debugging. */
  formatFaqsForPrompt(): string {
    const k = this.getKnowledge();
    return k.faqs
      .map((f, i) => {
        const cat = f.category ? ` [${f.category}]` : '';
        return `${i + 1}.${cat}\n${f.question}\n\n${f.answer}`;
      })
      .join('\n\n---\n\n');
  }

  /** Subset for retrieval: each entry must show id for citations */
  formatRetrievedForPrompt(items: { stableId: string; entry: FaqEntry }[]): string {
    return items
      .map(({ stableId, entry }) => {
        const cat = entry.category ? ` category="${entry.category}"` : '';
        return `FAQ id="${stableId}"${cat}\n${entry.question}\n\nKNOWLEDGE:\n${entry.answer}`;
      })
      .join('\n\n---\n\n');
  }

  getKnowledgeVersion(): string {
    return this.getKnowledge().version?.trim() || '1';
  }
}

function emptyKnowledge(scope: string): FaqKnowledgeFile {
  return {
    version: '0',
    chatbotTitle: 'FAQ Assistant',
    scopeDescription: scope,
    faqs: [],
  };
}
