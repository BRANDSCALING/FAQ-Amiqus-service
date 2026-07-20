import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

/** Options passed from FaqChatService (structured output + limits). */
export interface FaqOpenAiChatOptions {
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  response_format?: 'json_object' | 'text' | Record<string, unknown>;
}

export interface FaqOpenAiChatResult {
  content: string;
  model: string;
}

/**
 * OpenAI-only chat completions for FAQ — keeps the FAQ module independent of
 * DI agent LLM orchestration (multi-provider stack).
 */
@Injectable()
export class FaqOpenAiChatService {
  private readonly client: OpenAI;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('OPENAI_API_KEY')?.trim();
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not set (required for FAQ LLM)');
    }
    this.client = new OpenAI({ apiKey });
  }

  async generateResponse(
    model: string,
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
    options: FaqOpenAiChatOptions = {},
  ): Promise<FaqOpenAiChatResult> {
    const requestParams: Record<string, unknown> = {
      model,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.max_tokens ?? 4000,
    };
    if (options.top_p !== undefined) {
      requestParams.top_p = options.top_p;
    }
    if (options.response_format && typeof options.response_format === 'object') {
      requestParams.response_format = options.response_format;
    } else if (options.response_format === 'json_object') {
      requestParams.response_format = { type: 'json_object' };
    }

    const completion = (await this.client.chat.completions.create(
      requestParams as unknown as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
    )) as OpenAI.Chat.ChatCompletion;
    return {
      content: completion.choices[0]?.message?.content ?? '',
      model,
    };
  }
}
