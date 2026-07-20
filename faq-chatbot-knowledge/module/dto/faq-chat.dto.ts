import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, Length, Matches } from 'class-validator';

export class FaqChatRequestDto {
  @ApiProperty({ example: 'How do I reset my password?' })
  @IsString()
  @IsNotEmpty()
  @Length(1, 8000, { message: 'Message must be between 1 and 8,000 characters.' })
  @Matches(/^(?!\s*$).+/, { message: 'Message cannot be only whitespace' })
  message: string;

  @ApiPropertyOptional({ description: 'Optional client id for server logs (no PII).' })
  @IsOptional()
  @IsString()
  @Length(1, 128)
  clientRequestId?: string;
}

export class FaqChatMetaResponseDto {
  chatbotTitle: string;
  scopeDescription: string;
  categories: string[];
  faqCount: number;
  /** Knowledge file version (bump in faq-meta.json when content changes). */
  knowledgeVersion: string;
}

export class FaqChatResponseDto {
  @ApiProperty()
  response: string;

  @ApiProperty({ description: 'True when the model marked the question as outside FAQ scope.' })
  outOfScope: boolean;

  @ApiProperty({ description: 'FAQ ids used to ground the answer (audit trail).' })
  citedFaqIds: string[];

  @ApiProperty()
  latencyMs: number;

  @ApiProperty()
  knowledgeVersion: string;

  @ApiProperty({ description: 'True if this reply was served from short-lived cache.' })
  fromCache: boolean;
}

export class FaqChatHealthDto {
  ok: boolean;
  faqCount: number;
  knowledgeVersion: string;
  knowledgePath: string | null;
  /** Resolved questions.md path (section source). */
  questionsPath: string | null;
  /** True when OpenAI embeddings built a LlamaIndex vector index (otherwise lexical fallback). */
  ragEmbeddingsReady: boolean;
}
