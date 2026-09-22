import { Controller, Get, Post, Param, Body, Request, BadRequestException, ParseIntPipe } from '@nestjs/common';
import { LicenseRequestsService } from './license-requests.service.js';
import { RequirePermissions } from '../auth/permissions.decorator.js';

@Controller('customer/license-requests')
export class LicenseRequestsController {
  constructor(private readonly requestsService: LicenseRequestsService) {}

  @Get()
  @RequirePermissions('license_request.read')
  async findAll(@Request() req: any) {
    return this.requestsService.findAll(
      req.user.allowedCompanyIds,
      req.user.enterpriseId,
    );
  }

  @Get(':id')
  @RequirePermissions('license_request.read')
  async findOne(@Param('id') id: string, @Request() req: any) {
    return this.requestsService.findOne(
      id,
      req.user.allowedCompanyIds,
      req.user.enterpriseId,
    );
  }

  @Post()
  @RequirePermissions('license_request.create')
  async create(
    @Body('companyId') companyId: string,
    @Body('entitlementId') entitlementId: string,
    @Body('quantity', ParseIntPipe) quantity: number,
    @Body('reason') reason: string,
    @Body('targetUserId') targetUserId: string | undefined,
    @Request() req: any,
  ) {
    if (!companyId || !entitlementId) {
      throw new BadRequestException('companyId and entitlementId are required');
    }
    if (
      !req.user.allowedCompanyIds.includes('*') &&
      !req.user.allowedCompanyIds.includes(companyId)
    ) {
      throw new BadRequestException('Cannot create request for an unauthorized company');
    }
    return this.requestsService.create(companyId, entitlementId, quantity, reason, req.user.id, targetUserId);
  }

  @Post(':id/approve')
  @RequirePermissions('license_request.approve')
  async approve(@Param('id') id: string, @Request() req: any) {
    return this.requestsService.approve(
      id,
      req.user.allowedCompanyIds,
      req.user.enterpriseId,
      req.user.id,
    );
  }

  @Post(':id/reject')
  @RequirePermissions('license_request.reject')
  async reject(
    @Param('id') id: string,
    @Body('reason') reason: string,
    @Request() req: any,
  ) {
    return this.requestsService.reject(
      id,
      req.user.allowedCompanyIds,
      req.user.enterpriseId,
      reason,
      req.user.id,
    );
  }
}
