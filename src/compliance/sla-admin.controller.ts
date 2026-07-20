import { BadRequestException, Controller, Delete, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ComplianceService } from './compliance.service';

/**
 * Admin-only SLA helpers — fetches a pre-signed PDF URL for a signed SLA
 * submission so admins can view the document without logging into the
 * DocuSeal dashboard.
 *
 * Mounted at /api/admin/sla. Auth is implicit: the Unified backend's admin
 * proxy is the only legitimate caller; it only forwards requests from
 * authenticated admin users. The DocuSeal API key (DOCUSEAL_API_KEY) is
 * read from this service's environment.
 */
@ApiTags('sla-admin')
@Controller('api/admin/sla')
export class SlaAdminController {
  constructor(private readonly compliance: ComplianceService) {}

  @Get(':submissionId/document-url')
  @ApiOperation({
    summary:
      'Resolve a short-lived, token-authenticated URL for the signed SLA PDF on a DocuSeal submission. Returns { submissionId, url, source, status }.',
  })
  async getDocumentUrl(@Param('submissionId') submissionId: string) {
    if (!submissionId || !/^\d+$/.test(String(submissionId).trim())) {
      throw new BadRequestException('submissionId must be a positive integer');
    }
    return this.compliance.getSlaDocumentUrl(submissionId);
  }

  @Delete(':submissionId')
  @ApiOperation({
    summary:
      'Delete a DocuSeal submission so the partner can sign a fresh one. Idempotent — returns success even if the submission was already deleted upstream.',
  })
  async deleteSubmission(@Param('submissionId') submissionId: string) {
    if (!submissionId || !/^\d+$/.test(String(submissionId).trim())) {
      throw new BadRequestException('submissionId must be a positive integer');
    }
    return this.compliance.deleteSlaSubmission(submissionId);
  }
}
