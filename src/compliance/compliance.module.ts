import { Module } from '@nestjs/common';
import {
  ComplianceApiController,
  ComplianceWebhooksController,
  ContractsApiController,
} from './compliance.controller';
import { ComplianceService } from './compliance.service';
import { AmiqusAdminController } from './amiqus-admin.controller';
import { AmiqusAdminService } from './amiqus-admin.service';

/**
 * Isolated compliance + e-sign integration (Amiqus, DocuSeal).
 * No imports from DI agent, FAQ, or chat modules.
 *
 * AmiqusAdminController/Service handle admin operations the static
 * AMIQUS_API_KEY isn't scoped for — name-change corrections approval.
 */
@Module({
  controllers: [
    ComplianceApiController,
    ContractsApiController,
    ComplianceWebhooksController,
    AmiqusAdminController,
  ],
  providers: [ComplianceService, AmiqusAdminService],
  exports: [ComplianceService, AmiqusAdminService],
})
export class ComplianceModule {}
