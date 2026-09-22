import { Controller, Get, Post, Param, Body, Request, ParseIntPipe, BadRequestException } from '@nestjs/common';
import { LicensesService } from './licenses.service.js';
import { RequirePermissions } from '../auth/permissions.decorator.js';

@Controller('customer/licenses')
export class LicensesController {
  constructor(private readonly licensesService: LicensesService) {}

  @Get()
  @RequirePermissions('license.read')
  async findAll(@Request() req: any) {
    return this.licensesService.findAll(req.user.allowedCompanyIds);
  }

  @Get(':id')
  @RequirePermissions('license.read')
  async findOne(@Param('id') id: string, @Request() req: any) {
    return this.licensesService.findOne(id, req.user.allowedCompanyIds);
  }

  @Post('allocate')
  @RequirePermissions('license.allocate')
  async allocate(
    @Body('entitlementId') entitlementId: string,
    @Body('companyId') companyId: string,
    @Body('quantity', ParseIntPipe) quantity: number,
    @Request() req: any
  ) {
    // Basic safety: Company Admin can only allocate to their own company unless they are Enterprise Admin
    if (!req.user.allowedCompanyIds.includes('*') && !req.user.allowedCompanyIds.includes(companyId)) {
      throw new BadRequestException('Cannot allocate to an unauthorized company');
    }
    return this.licensesService.allocate(entitlementId, companyId, quantity, req.user.id);
  }

  @Post(':id/suspend')
  @RequirePermissions('license.suspend')
  async suspend(@Param('id') id: string, @Request() req: any) {
    return this.licensesService.setStatus(id, req.user.allowedCompanyIds, 'SUSPENDED', req.user.id);
  }

  @Post(':id/reactivate')
  @RequirePermissions('license.suspend')
  async reactivate(@Param('id') id: string, @Request() req: any) {
    return this.licensesService.setStatus(id, req.user.allowedCompanyIds, 'ACTIVE', req.user.id);
  }

  @Post(':id/revoke')
  @RequirePermissions('license.revoke')
  async revoke(@Param('id') id: string, @Request() req: any) {
    return this.licensesService.setStatus(id, req.user.allowedCompanyIds, 'REVOKED', req.user.id);
  }
}
