import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { FaqChatController } from '../faq-chatbot-knowledge/module/faq-chat.controller';
import { FaqChatService } from '../faq-chatbot-knowledge/module/faq-chat.service';
import { FaqKnowledgeLoaderService } from '../faq-chatbot-knowledge/module/faq-knowledge-loader.service';
import { FaqLlamaIndexRagService } from '../faq-chatbot-knowledge/module/faq-llamaindex-rag.service';
import { FaqRetrievalService } from '../faq-chatbot-knowledge/module/faq-retrieval.service';
import { FaqChatCacheService } from '../faq-chatbot-knowledge/module/faq-chat-cache.service';
import { FaqChatRateLimitGuard } from '../faq-chatbot-knowledge/module/faq-chat-rate-limit.guard';
import { FaqOpenAiChatService } from '../faq-chatbot-knowledge/module/faq-open-ai-chat.service';
import { FaqAnthropicChatService } from '../faq-chatbot-knowledge/module/faq-anthropic-chat.service';
import { ComplianceModule } from './compliance/compliance.module';

/**
 * Standalone Nest app: UCWS FAQ chatbot + Amiqus / DocuSeal compliance.
 * Split from the Decision Intelligence (Alchemist) agent for separate deploy and repo.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ComplianceModule,
  ],
  controllers: [FaqChatController],
  providers: [
    FaqKnowledgeLoaderService,
    FaqLlamaIndexRagService,
    FaqRetrievalService,
    FaqChatCacheService,
    FaqChatRateLimitGuard,
    FaqOpenAiChatService,
    FaqAnthropicChatService,
    FaqChatService,
  ],
})
export class AppModule {}
