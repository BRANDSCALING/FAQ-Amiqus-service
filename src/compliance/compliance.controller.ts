import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Logger,
  Post,
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

      const headerVal = req.headers['x-hub-signature'];
      const sigHeader = Array.isArray(headerVal) ? headerVal[0] : headerVal;
      if (!sigHeader || !/^sha256=/i.test(sigHeader)) {
        throw new UnauthorizedException();
      }

      const providedHex = sigHeader.replace(/^sha256=/i, '').trim();
      const expected = createHmac('sha256', secret).update(rawBody).digest();
      if (
        providedHex.length !== expected.length * 2 ||
        !/^[0-9a-f]+$/i.test(providedHex)
      ) {
        throw new UnauthorizedException();
      }
      const provided = Buffer.from(providedHex, 'hex');
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
