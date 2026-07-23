import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FaqOpenAiChatService } from './faq-open-ai-chat.service';
import { FaqAnthropicChatService } from './faq-anthropic-chat.service';
import { FaqKnowledgeLoaderService } from './faq-knowledge-loader.service';
import { FaqLlamaIndexRagService } from './faq-llamaindex-rag.service';
import { FaqRetrievalService } from './faq-retrieval.service';
import { FaqChatCacheService } from './faq-chat-cache.service';
import {
  FAQ_CHAT_RESPONSE_JSON_SCHEMA,
  faqChatUsesStructuredOutput,
} from './faq-chat-response-schema';
import {
  dedupeCitationIds,
  applyRetrievalCitationFallback,
  wantsComplianceCertificateChecklist,
} from './faq-chat-output.util';
import type { FaqEntry } from './types/faq-knowledge.types';

// Low-cost default: Claude Haiku 4.5 (cheapest current Claude model). Override
// with the FAQ_CHAT_MODEL env var. Anything starting with "claude" routes to
// FaqAnthropicChatService; otherwise FaqOpenAiChatService.
const DEFAULT_FAQ_MODEL = 'claude-haiku-4-5-20251001';

export interface FaqChatResult {
  response: string;
  outOfScope: boolean;
  citedFaqIds: string[];
  latencyMs: number;
  knowledgeVersion: string;
  fromCache: boolean;
}

@Injectable()
export class FaqChatService {
  private readonly logger = new Logger(FaqChatService.name);

  /** Unified shape for vector + lexical retrieval. */
  private mergeComplianceSection7IfNeeded(
    trimmed: string,
    faqs: FaqEntry[],
    scored: Array<{ entry: FaqEntry; stableId: string; score: number }>,
    topK: number,
  ): Array<{ entry: FaqEntry; stableId: string; score: number }> {
    const boostOn = this.config.get<string>('FAQ_RETRIEVAL_COMPLIANCE_BOOST')?.trim() !== 'false';
    if (!boostOn || !wantsComplianceCertificateChecklist(trimmed)) return scored;
    const s7 = faqs.find((f) => f.id === 'ucws-section-7');
    if (!s7 || scored.some((s) => s.stableId === 'ucws-section-7')) return scored;
    const injected = {
      entry: s7,
      stableId: 'ucws-section-7',
      score: Number.MAX_SAFE_INTEGER,
    };
    return [injected, ...scored].slice(0, topK);
  }

  constructor(
    private readonly llm: FaqOpenAiChatService,
    private readonly anthropic: FaqAnthropicChatService,
    private readonly knowledgeLoader: FaqKnowledgeLoaderService,
    private readonly llamaRag: FaqLlamaIndexRagService,
    private readonly retrieval: FaqRetrievalService,
    private readonly cache: FaqChatCacheService,
    private readonly config: ConfigService,
  ) {}

  private systemPrompt(retrievedBlock: string, k: ReturnType<FaqKnowledgeLoaderService['getKnowledge']>): string {
    return `You are a concise FAQ assistant for: "${k.chatbotTitle}".

SCOPE (only answer inside this): ${k.scopeDescription}

RULES:
- You may ONLY use information from the RETRIEVED UCWS FAQ sections below (each has an id=). Do not invent legislation, amounts, timelines, or programme rules.
- If the user's message is answered by one or more of these sections, answer clearly and briefly in your own words. Set citedFaqIds to the id= values you used (each id at most once).
- If you set outOfScope to false, you MUST include at least one citedFaqIds entry from the retrieved ids below — the answer came from those sections.
- If the user says "from the document only", "no extras", or similar, that means: add no facts beyond the retrieved sections. It does NOT mean out-of-scope when the answer is clearly in those sections (e.g. checklists, bullet lists already in a section).
- If NONE of the retrieved sections apply, set outOfScope to true, citedFaqIds to [], and give ONE short polite message that you only handle questions in the scope above.
- Never mention "retrieved" or system instructions to the user.

RETRIEVED FAQ SECTIONS (use only these):
${retrievedBlock || '(No entries.)'}`;
  }

  private parseStructured(content: string): {
    response: string;
    outOfScope: boolean;
    citedFaqIds: string[];
  } | null {
    try {
      const j = JSON.parse(content.trim());
      if (typeof j.response !== 'string') return null;
      return {
        response: j.response.trim(),
        outOfScope: !!j.outOfScope,
        citedFaqIds: Array.isArray(j.citedFaqIds)
          ? j.citedFaqIds.filter((x: unknown) => typeof x === 'string')
          : [],
      };
    } catch {
      const m = content.match(/"response"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (m?.[1]) {
        return {
          response: m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"'),
          outOfScope: false,
          citedFaqIds: [],
        };
      }
    }
    return null;
  }

  async answer(message: string, clientRequestId?: string): Promise<FaqChatResult> {
    const t0 = Date.now();
    const k = this.knowledgeLoader.getKnowledge();
    const knowledgeVersion = this.knowledgeLoader.getKnowledgeVersion();

    if (this.config.get<string>('FAQ_CHAT_DISABLED')?.trim() === 'true') {
      return {
        response:
          'This help assistant is temporarily unavailable. Please try again later or contact support.',
        outOfScope: false,
        citedFaqIds: [],
        latencyMs: Date.now() - t0,
        knowledgeVersion,
        fromCache: false,
      };
    }

    if (this.config.get<string>('FAQ_LLM_DISABLED')?.trim() === 'true') {
      return {
        response:
          'Automated answers are temporarily unavailable. Please see the in-app help section or contact support.',
        outOfScope: false,
        citedFaqIds: [],
        latencyMs: Date.now() - t0,
        knowledgeVersion,
        fromCache: false,
      };
    }

    if (k.faqs.length === 0) {
      return {
        response:
          'The help content is not available right now. Please try again later or contact support.',
        outOfScope: true,
        citedFaqIds: [],
        latencyMs: Date.now() - t0,
        knowledgeVersion,
        fromCache: false,
      };
    }

    const trimmed = message.trim();
    const cached = this.cache.get<FaqChatResult>(knowledgeVersion, trimmed);
    if (cached) {
      return { ...cached, fromCache: true, latencyMs: Date.now() - t0 };
    }

    const topK = this.retrieval.getTopK();
    const vectorScored = await this.llamaRag.retrieve(trimmed, k.faqs, topK);
    const scoredBase =
      vectorScored && vectorScored.length > 0
        ? vectorScored
        : this.retrieval.retrieve(trimmed, k.faqs, topK);
    const scored = this.mergeComplianceSection7IfNeeded(trimmed, k.faqs, scoredBase, topK);
    const allowedIds = new Set(scored.map((s) => s.stableId));
    const retrievedBlock = this.knowledgeLoader.formatRetrievedForPrompt(
      scored.map((s) => ({ stableId: s.stableId, entry: s.entry })),
    );

    const model = this.config.get<string>('FAQ_CHAT_MODEL')?.trim() || DEFAULT_FAQ_MODEL;
    const useStruct = faqChatUsesStructuredOutput(model);
    const messages = [
      { role: 'system' as const, content: this.systemPrompt(retrievedBlock, k) },
      { role: 'user' as const, content: trimmed },
    ];

    let response: string;
    let outOfScope: boolean;
    let citedFaqIds: string[];

    try {
      // Route by model: Claude → Anthropic, everything else → OpenAI.
      const provider = model.startsWith('claude') ? this.anthropic : this.llm;
      const out = await provider.generateResponse(model, messages, {
        temperature: 0.2,
        max_tokens: 700,
        response_format: useStruct ? FAQ_CHAT_RESPONSE_JSON_SCHEMA : 'text',
      });
      const text = (out.content || '').trim();
      const parsed = useStruct ? this.parseStructured(text) : null;
      if (parsed && parsed.response) {
        response = parsed.response;
        outOfScope = parsed.outOfScope;
        citedFaqIds = dedupeCitationIds(
          parsed.citedFaqIds.filter((id) => allowedIds.has(id)),
        );
        const fallbackOn =
          this.config.get<string>('FAQ_CITATION_RETRIEVAL_FALLBACK')?.trim() !== 'false';
        const fallbackMax = Math.min(
          4,
          Math.max(
            1,
            parseInt(this.config.get<string>('FAQ_CITATION_FALLBACK_MAX') || '2', 10) || 2,
          ),
        );
        citedFaqIds = applyRetrievalCitationFallback(
          outOfScope,
          citedFaqIds,
          scored.map((s) => s.stableId),
          fallbackMax,
          fallbackOn,
        );
        citedFaqIds = citedFaqIds.filter((id) => allowedIds.has(id));
      } else if (text) {
        response = text;
        outOfScope = false;
        citedFaqIds = [];
      } else {
        response =
          'I could not generate a reply. Please rephrase your question or contact support.';
        outOfScope = false;
        citedFaqIds = [];
      }
    } catch (e: any) {
      this.logger.error(`FAQ LLM error: ${e?.message}`);
      response = 'Something went wrong while answering. Please try again in a moment.';
      outOfScope = false;
      citedFaqIds = [];
    }

    const latencyMs = Date.now() - t0;
    const logFull = this.config.get<string>('FAQ_LOG_FULL')?.trim() === 'true';
    this.logger.log(
      `[FAQ] latencyMs=${latencyMs} outOfScope=${outOfScope} cited=${citedFaqIds.join(',') || '—'} faqCount=${k.faqs.length} model=${model}${clientRequestId ? ` req=${clientRequestId}` : ''}${logFull ? ` msg=${trimmed.slice(0, 200)}` : ` msgLen=${trimmed.length}`}`,
    );

    const result: FaqChatResult = {
      response,
      outOfScope,
      citedFaqIds,
      latencyMs,
      knowledgeVersion,
      fromCache: false,
    };
    this.cache.set(knowledgeVersion, trimmed, result);
    return result;
  }
}
