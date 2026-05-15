import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  FaqChatRequestDto,
  FaqChatMetaResponseDto,
  FaqChatResponseDto,
  FaqChatHealthDto,
} from './dto/faq-chat.dto';
import { FaqChatService } from './faq-chat.service';
import { FaqKnowledgeLoaderService } from './faq-knowledge-loader.service';
import { FaqLlamaIndexRagService } from './faq-llamaindex-rag.service';
import { FaqChatRateLimitGuard } from './faq-chat-rate-limit.guard';

@ApiTags('faq-chat')
@Controller('faq-chat')
export class FaqChatController {
  constructor(
    private readonly faqChat: FaqChatService,
    private readonly knowledge: FaqKnowledgeLoaderService,
    private readonly llamaRag: FaqLlamaIndexRagService,
  ) {}

  @Get('health')
  @ApiOperation({ summary: 'FAQ knowledge loaded and non-empty (for deploy checks)' })
  @ApiResponse({ status: 200 })
  getHealth(): FaqChatHealthDto {
    const k = this.knowledge.getKnowledge();
    const version = this.knowledge.getKnowledgeVersion();
    return {
      ok: k.faqs.length > 0,
      faqCount: k.faqs.length,
      knowledgeVersion: version,
      knowledgePath: this.knowledge.getLoadedPath(),
      questionsPath: this.knowledge.getQuestionsPath(),
      ragEmbeddingsReady: this.llamaRag.isReady(),
    };
  }

  @Get('meta')
  @ApiOperation({ summary: 'FAQ chatbot metadata (title, scope, categories) for iOS UI' })
  @ApiResponse({ status: 200 })
  getMeta(): FaqChatMetaResponseDto {
    const k = this.knowledge.getKnowledge();
    const categories = [
      ...new Set(
        k.faqs.map((f) => (f.category || 'General').trim()).filter(Boolean),
      ),
    ].sort();
    return {
      chatbotTitle: k.chatbotTitle,
      scopeDescription: k.scopeDescription,
      categories,
      faqCount: k.faqs.length,
      knowledgeVersion: this.knowledge.getKnowledgeVersion(),
    };
  }

  @Post()
  @UseGuards(FaqChatRateLimitGuard)
  @ApiOperation({ summary: 'Ask the FAQ chatbot (retrieval + grounded LLM + citations)' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  async chat(@Body() body: FaqChatRequestDto): Promise<FaqChatResponseDto> {
    const r = await this.faqChat.answer(body.message, body.clientRequestId);
    return {
      response: r.response,
      outOfScope: r.outOfScope,
      citedFaqIds: r.citedFaqIds,
      latencyMs: r.latencyMs,
      knowledgeVersion: r.knowledgeVersion,
      fromCache: r.fromCache,
    };
  }
}
