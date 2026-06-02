import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class InitAmiqusDto {
  @ApiProperty({ example: 'Jane' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  firstName: string;

  /**
   * Optional. When present, gets written to the Amiqus client's
   * `middle_name` field so the photo-ID match step sees the same
   * middle name that's printed on the document.
   */
  @ApiPropertyOptional({ example: 'Marie' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  middleName?: string;

  @ApiProperty({ example: 'Doe' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  lastName: string;

  @ApiProperty({ example: 'jane.doe@example.com' })
  @IsEmail()
  @MaxLength(320)
  email: string;
}

// 'SLA' is the live combined HSP + Tenant SLA (DocuSeal template 4).
// 'HSPSLA' and 'TENANTS' are the legacy standalone agreements kept for
// backwards-compatibility — the new Compliance UI only ever sends 'SLA'.
export type ContractType = 'SLA' | 'HSPSLA' | 'TENANTS';

export class InitDocuSealDto {
  @ApiProperty({ example: 'hsp@example.com' })
  @IsEmail()
  @MaxLength(320)
  hspEmail: string;

  @ApiProperty({ example: 'Jane HSP' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  hspName: string;

  @ApiProperty({ example: 'Acme Housing Ltd' })
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  companyName: string;

  @ApiProperty({ example: '12345678' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  companyRegNumber: string;

  @ApiProperty({ example: '1 London Road, London, EC1A 1BB' })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  registeredAddress: string;

  @ApiProperty({ enum: ['SLA', 'HSPSLA', 'TENANTS'] })
  @IsString()
  @IsIn(['SLA', 'HSPSLA', 'TENANTS'])
  contractType: ContractType;
}

/** Optional nested shapes some Amiqus webhook payloads use */
export class AmiqusWebhookRecordDto {
  @ApiPropertyOptional()
  @IsOptional()
  id?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;
}

/**
 * Webhook bodies vary by Amiqus configuration. We only validate when these fields exist;
 * the service still reads from the raw object for fallbacks.
 */
export class AmiqusWebhookDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  id?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => AmiqusWebhookRecordDto)
  record?: AmiqusWebhookRecordDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;
}

export class DocuSealWebhookSubmissionDto {
  @ApiPropertyOptional()
  @IsOptional()
  id?: number;

  @ApiPropertyOptional()
  @IsOptional()
  template_id?: number;
}

/**
 * DocuSeal webhook payloads differ by event type; keep optional fields for validation only.
 */
export class DocuSealWebhookDto {
  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => DocuSealWebhookSubmissionDto)
  submission?: DocuSealWebhookSubmissionDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;
}
