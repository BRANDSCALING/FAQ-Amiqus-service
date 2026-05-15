import { Module } from '@nestjs/common';
import {
  ComplianceApiController,
  ComplianceWebhooksController,
  ContractsApiController,
} from './compliance.controller';
import { ComplianceService } from './compliance.service';

/**
 * Isolated compliance + e-sign integration (Amiqus, DocuSeal).
 * No imports from DI agent, FAQ, or chat modules.
 */
@Module({
  controllers: [ComplianceApiController, ContractsApiController, ComplianceWebhooksController],
  providers: [ComplianceService],
  exports: [ComplianceService],
})
export class ComplianceModule {}
