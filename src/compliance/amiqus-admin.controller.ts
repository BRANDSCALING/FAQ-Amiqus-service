import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AmiqusAdminService } from './amiqus-admin.service';

/**
 * Admin-only Amiqus operations — listing pending name-change corrections
 * and approving / rejecting them. Mounted under /api/admin/amiqus so the
 * Unified backend's admin proxy can forward to it cleanly.
 *
 * Auth here is bearer-token implicit (the Unified backend's admin proxy
 * only forwards requests from authenticated admin/UCWS users). The
 * service itself uses an OAuth client-credentials-style access token to
 * call Amiqus.
 */
@ApiTags('amiqus-admin')
@Controller('api/admin/amiqus')
export class AmiqusAdminController {
  constructor(private readonly admin: AmiqusAdminService) {}

  @Get('pending-corrections')
  @ApiOperation({
    summary:
      'List every Amiqus record in amendments status with its pending client name-change correction. Used by the Allianz admin portal queue.',
  })
  async pendingCorrections() {
    return this.admin.listPendingCorrections();
  }

  @Post('corrections/:clientId/:correctionId/approve')
  @ApiOperation({
    summary:
      'Approve a single Amiqus name-change correction. Equivalent to clicking Approve in the Amiqus dashboard.',
  })
  async approveCorrection(
    @Param('clientId', ParseIntPipe) clientId: number,
    @Param('correctionId', ParseIntPipe) correctionId: number,
  ) {
    if (clientId <= 0 || correctionId <= 0) {
      throw new BadRequestException('clientId and correctionId must be positive integers');
    }
    return this.admin.approveCorrection(clientId, correctionId);
  }

  @Post('corrections/:clientId/:correctionId/reject')
  @ApiOperation({
    summary:
      'Reject a single Amiqus name-change correction. Equivalent to clicking Reject in the Amiqus dashboard.',
  })
  async rejectCorrection(
    @Param('clientId', ParseIntPipe) clientId: number,
    @Param('correctionId', ParseIntPipe) correctionId: number,
  ) {
    if (clientId <= 0 || correctionId <= 0) {
      throw new BadRequestException('clientId and correctionId must be positive integers');
    }
    return this.admin.rejectCorrection(clientId, correctionId);
  }
}
