import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { FAQ_CHAT_RESPONSE_JSON_SCHEMA } from './faq-chat-response-schema';

/** Options passed from FaqChatService — same shape as the OpenAI service so
 *  the two are interchangeable behind a model-name router. */
export interface FaqAnthropicChatOptions {
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  response_format?: 'json_object' | 'text' | Record<string, unknown>;
}

export interface FaqAnthropicChatResult {
  content: string;
  model: string;
}

/** Tool name used to force structured JSON out of Claude (Anthropic has no
 *  OpenAI-style `response_format` json_schema, so we use forced tool-use). */
const FAQ_TOOL_NAME = 'faq_chat_response';

/**
 * Claude (Anthropic) chat completions for FAQ. Mirrors FaqOpenAiChatService's
 * `generateResponse(model, messages, options)` contract so FaqChatService can
 * route to it by model name (anything starting with "claude").
 *
 * Structured output: when `response_format` is the FAQ JSON-schema object we
 * expose that schema as a single tool and force `tool_choice` to it, then
 * return the tool input JSON-stringified — so the caller's existing
 * `parseStructured()` reads it exactly like the OpenAI structured output.
 *
 * The client is created lazily (not in the constructor) so the Nest app boots
 * even if ANTHROPIC_API_KEY isn't set yet; the error only surfaces on use.
 */
@Injectable()
export class FaqAnthropicChatService {
  private readonly logger = new Logger(FaqAnthropicChatService.name);
  private client: Anthropic | null = null;

  constructor(private readonly config: ConfigService) {}

  private getClient(): Anthropic {
    if (this.client) return this.client;
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY')?.trim();
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not set (required for FAQ LLM on Claude)');
    }
    this.client = new Anthropic({ apiKey });
    return this.client;
  }

  async generateResponse(
    model: string,
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
    options: FaqAnthropicChatOptions = {},
  ): Promise<FaqAnthropicChatResult> {
    const client = this.getClient();

    // Anthropic takes the system prompt as a top-level `system` string, not as
    // a message with role 'system'. Split it out; keep user/assistant turns.
    const system = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n')
      .trim();
    const turns = messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    const wantsStructured =
      !!options.response_format && typeof options.response_format === 'object';

    const req: Anthropic.MessageCreateParamsNonStreaming = {
      model,
      max_tokens: options.max_tokens ?? 1024,
      temperature: options.temperature ?? 0.7,
      messages: turns,
    };
    if (system) req.system = system;
    if (options.top_p !== undefined) req.top_p = options.top_p;

    if (wantsStructured) {
      const schema = (FAQ_CHAT_RESPONSE_JSON_SCHEMA as any)?.json_schema?.schema;
      if (schema) {
        req.tools = [
          {
            name: FAQ_TOOL_NAME,
            description:
              'Return the FAQ answer in the required structured format. Always call this tool.',
            input_schema: schema as Anthropic.Tool.InputSchema,
          },
        ];
        req.tool_choice = { type: 'tool', name: FAQ_TOOL_NAME };
      }
    }

    const msg = await client.messages.create(req);
    const blocks = Array.isArray(msg.content) ? msg.content : [];

    if (wantsStructured) {
      const toolBlock = blocks.find((b: any) => b.type === 'tool_use') as any;
      if (toolBlock && toolBlock.input) {
        // JSON-stringify so the caller's parseStructured() handles it exactly
        // like the OpenAI structured-output string.
        return { content: JSON.stringify(toolBlock.input), model };
      }
      this.logger.warn('Claude did not return the expected tool_use block; falling back to text.');
    }

    const text = blocks
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('')
      .trim();
    return { content: text, model };
  }
}
