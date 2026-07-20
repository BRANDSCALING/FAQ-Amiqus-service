import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Logger,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { createHmac, timingSafeEqual } from 'crypto';
import type { Request } from 'express';
import { ComplianceService } from './compliance.service';
import { InitAmiqusDto, InitDocuSealDto } from './dto/compliance.dto';

type RequestWithRawBody = Request & { rawBody?: Buffer };

@ApiTags('compliance')
@Controller('api/compliance')
export class ComplianceApiController {
  constructor(private readonly compliance: ComplianceService) {}

  @Post('init-amiqus')
  @ApiOperation({ summary: 'Start Amiqus KYC + DBS record; returns perform_url' })
  async initAmiqus(@Body() dto: InitAmiqusDto) {
    return this.compliance.initAmiqus(dto);
  }

  @Get('amiqus-steps')
  @ApiOperation({
    summary:
      'List step types Amiqus exposes for this workspace (GET /api/v2/steps). Use to confirm check.criminal_record before enabling DBS.',
  })
  async amiqusSteps() {
    return this.compliance.getAmiqusStepsDiagnostic();
  }

  @Get('amiqus-status')
  @ApiOperation({
    summary:
      'Poll the current status of an Amiqus record. Returns { approved, status, recordId }. recordId query param required.',
  })
  async amiqusStatus(@Query('recordId') recordId?: string) {
    if (!recordId) {
      throw new BadRequestException('recordId query parameter is required');
    }
    return this.compliance.getAmiqusRecordStatus(recordId);
  }

  @Get('resume-url')
  @ApiOperation({
    summary:
      'Resume URL for an in-progress Amiqus record. Returns { recordId, url, recordStatus, terminal }. recordId query param required. `url` is null if the record is no longer resumable. `terminal=true` specifically means the record is expired/cancelled/withdrawn — the caller should reset state and let the user start a fresh session.',
  })
  async amiqusResumeUrl(@Query('recordId') recordId?: string) {
    if (!recordId) {
      throw new BadRequestException('recordId query parameter is required');
    }
    return this.compliance.getAmiqusResumeUrl(recordId);
  }
}

@ApiTags('compliance-contracts')
@Controller('api/contracts')
export class ContractsApiController {
  constructor(private readonly compliance: ComplianceService) {}

  @Post('init-docuseal')
  @ApiOperation({ summary: 'Create DocuSeal submission (HSP + PMA); returns HSP slug for embed' })
  async initDocuSeal(@Body() dto: InitDocuSealDto) {
    return this.compliance.initDocuSeal(dto);
  }

  @Get('resume-url')
  @ApiOperation({
    summary:
      'Resume URL + live state for an existing DocuSeal submission. Returns { submissionId, url, signed, opened, submitterStatus }.',
  })
  async docuSealResumeUrl(@Query('submissionId') submissionId?: string) {
    if (!submissionId) {
      throw new BadRequestException('submissionId query parameter is required');
    }
    return this.compliance.getDocuSealResumeUrl(submissionId);
  }
}

@ApiTags('compliance-webhooks')
@Controller('api/webhooks')
export class ComplianceWebhooksController {
  private readonly logger = new Logger(ComplianceWebhooksController.name);

  constructor(
    private readonly compliance: ComplianceService,
    private readonly config: ConfigService,
  ) {}

  @Post('amiqus')
  @ApiOperation({ summary: 'Amiqus record status webhook' })
  async amiqusWebhook(@Req() req: Request) {
    const secret = this.config.get<string>('AMIQUS_WEBHOOK_SECRET')?.trim();
    let payload: Record<string, unknown>;

    if (!secret) {
      this.logger.warn(
        'AMIQUS_WEBHOOK_SECRET is not set; skipping Amiqus webhook signature verification',
      );
      payload = this.bodyAsRecord(req.body);
    } else {
      const rawBody = (req as RequestWithRawBody).rawBody;
      if (!rawBody || !Buffer.isBuffer(rawBody)) {
        throw new UnauthorizedException();
      }

      // Amiqus sends the HMAC-SHA256 of the raw body as a base64-encoded
      // string in the `X-AQID-Signature` header (NOT GitHub-style
      // `x-hub-signature: sha256=<hex>`). The signing secret is the one
      // shown on Workflow → Webhooks in the Amiqus dashboard, which the
      // operator pastes into AMIQUS_WEBHOOK_SECRET on the ECS task.
      const headerVal = req.headers['x-aqid-signature'];
      const sigHeader = Array.isArray(headerVal) ? headerVal[0] : headerVal;
      if (!sigHeader || typeof sigHeader !== 'string') {
        throw new UnauthorizedException();
      }

      const expected = createHmac('sha256', secret).update(rawBody).digest();
      // Buffer.from(..., 'base64') silently accepts invalid input and
      // produces garbage, so we rely on the length + timingSafeEqual checks
      // to reject malformed signatures.
      const provided = Buffer.from(sigHeader.trim(), 'base64');
      if (provided.length !== expected.length || !timingSafeEqual(expected, provided)) {
        throw new UnauthorizedException();
      }

      try {
        const parsed: unknown = JSON.parse(rawBody.toString('utf8'));
        payload = this.bodyAsRecord(parsed);
      } catch {
        throw new BadRequestException('Invalid JSON body');
      }
    }

    return this.compliance.handleAmiqusWebhook(payload);
  }

  @Post('docuseal')
  @ApiOperation({ summary: 'DocuSeal submission webhook' })
  async docusealWebhook(@Req() req: Request) {
    return this.compliance.handleDocuSealWebhook(this.bodyAsRecord(req.body));
  }

  private bodyAsRecord(body: unknown): Record<string, unknown> {
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      return body as Record<string, unknown>;
    }
    return {};
  }
}
