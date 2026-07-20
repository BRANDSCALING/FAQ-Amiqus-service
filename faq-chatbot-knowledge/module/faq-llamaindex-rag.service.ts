import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Document, Settings, VectorStoreIndex, storageContextFromDefaults } from 'llamaindex';
import { OpenAIEmbedding } from '@llamaindex/openai';
import { FaqKnowledgeLoaderService } from './faq-knowledge-loader.service';
import type { FaqEntry } from './types/faq-knowledge.types';

export interface ScoredFaqFromRag {
  entry: FaqEntry;
  stableId: string;
  score: number;
}

const DEFAULT_EMBED_MODEL = 'text-embedding-3-small';

@Injectable()
export class FaqLlamaIndexRagService implements OnModuleInit {
  private readonly logger = new Logger(FaqLlamaIndexRagService.name);
  private index: Awaited<ReturnType<typeof VectorStoreIndex.fromDocuments>> | null = null;
  private ready = false;

  constructor(
    private readonly config: ConfigService,
    private readonly knowledgeLoader: FaqKnowledgeLoaderService,
  ) {}

  async onModuleInit(): Promise<void> {
    const apiKey = this.config.get<string>('OPENAI_API_KEY')?.trim();
    const k = this.knowledgeLoader.getKnowledge();
    if (!apiKey) {
      this.logger.warn(
        'OPENAI_API_KEY missing — FAQ RAG embeddings disabled; using lexical fallback retrieval.',
      );
      return;
    }
    if (!k.faqs.length) {
      this.logger.warn('No FAQ sections loaded — skipping LlamaIndex index build.');
      return;
    }

    const embedModelName =
      this.config.get<string>('FAQ_EMBEDDING_MODEL')?.trim() || DEFAULT_EMBED_MODEL;

    try {
      Settings.embedModel = new OpenAIEmbedding({
        apiKey,
        model: embedModelName,
      });

      const docs = k.faqs.map(
        (f) =>
          new Document({
            text: `${f.question}\n\n${f.answer}`,
            metadata: { id: f.id || '' },
          }),
      );

      const storageContext = await storageContextFromDefaults({});
      this.index = await VectorStoreIndex.fromDocuments(docs, { storageContext });
      this.ready = true;
      this.logger.log(
        `LlamaIndex VectorStoreIndex built with ${docs.length} section chunks (embed: ${embedModelName}).`,
      );
    } catch (e: any) {
      this.logger.error(`LlamaIndex index build failed: ${e?.message}`);
      this.index = null;
      this.ready = false;
    }
  }

  isReady(): boolean {
    return this.ready && this.index !== null;
  }

  /**
   * Vector similarity retrieval over section chunks. Returns null if index unavailable.
   */
  async retrieve(userMessage: string, faqs: FaqEntry[], topK: number): Promise<ScoredFaqFromRag[] | null> {
    if (!this.index || !userMessage.trim()) return null;

    const k = Math.max(1, Math.min(topK, faqs.length));
    const byId = new Map<string, FaqEntry>();
    for (const f of faqs) {
      const id = f.id?.trim();
      if (id) byId.set(id, f);
    }

    try {
      const retriever = this.index.asRetriever({ similarityTopK: k });
      const results = await retriever.retrieve({ query: userMessage });

      const out: ScoredFaqFromRag[] = [];
      for (const r of results) {
        const meta = r.node?.metadata as { id?: string } | undefined;
        const id = meta?.id?.trim();
        const entry = id ? byId.get(id) : undefined;
        if (!entry || !id) continue;
        const score = typeof r.score === 'number' ? r.score : 0;
        out.push({ entry, stableId: id, score });
      }
      return out.length ? out : null;
    } catch (e: any) {
      this.logger.warn(`LlamaIndex retrieve failed: ${e?.message}`);
      return null;
    }
  }
}
