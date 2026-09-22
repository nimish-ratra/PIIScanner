import { Controller, Get, Post, Param, Request, Query } from '@nestjs/common';
import { InstallationsService } from './installations.service.js';
import { RequirePermissions } from '../auth/permissions.decorator.js';

@Controller('customer/installations')
export class InstallationsController {
  constructor(private readonly installationsService: InstallationsService) {}

  @Get()
  @RequirePermissions('installation.read')
  async getAllInstallations(
    @Request() req: any,
    @Query('companyId') companyId?: string,
    @Query('status') status?: string,
    @Query('version') version?: string
  ) {
    return this.installationsService.findAll(req.user.allowedCompanyIds, { companyId, status, version });
  }

  @Get(':id')
  @RequirePermissions('installation.read')
  async getInstallationById(@Param('id') id: string, @Request() req: any) {
    return this.installationsService.findOne(id, req.user.allowedCompanyIds, req.user.id);
  }

  @Post(':id/suspend')
  @RequirePermissions('installation.manage')
  async suspend(@Param('id') id: string, @Request() req: any) {
    return this.installationsService.setStatus(id, req.user.allowedCompanyIds, 'SUSPENDED', req.user.id);
  }

  @Post(':id/unsuspend')
  @RequirePermissions('installation.manage')
  async unsuspend(@Param('id') id: string, @Request() req: any) {
    return this.installationsService.setStatus(id, req.user.allowedCompanyIds, 'ACTIVE', req.user.id);
  }

  /**
   * Approves a PENDING self-service registration (see AgentService.register()'s
   * plain-token flow) — distinct action name from unsuspend even though both
   * ultimately transition to ACTIVE, since InstallationsService.setStatus()
   * picks the audit label based on the prior state either way.
   */
  @Post(':id/approve')
  @RequirePermissions('installation.manage')
  async approve(@Param('id') id: string, @Request() req: any) {
    return this.installationsService.setStatus(id, req.user.allowedCompanyIds, 'ACTIVE', req.user.id);
  }

  @Post(':id/revoke')
  @RequirePermissions('installation.manage')
  async revoke(@Param('id') id: string, @Request() req: any) {
    return this.installationsService.setStatus(id, req.user.allowedCompanyIds, 'REVOKED', req.user.id);
  }
}

@Controller('vendor/installations')
export class VendorInstallationsController {
  constructor(private readonly installationsService: InstallationsService) {}

  @Get()
  @RequirePermissions('*')
  async getAllInstallations() {
    return this.installationsService.findAll(['*']);
  }

  @Get(':id')
  @RequirePermissions('*')
  async getInstallationById(@Param('id') id: string) {
    return this.installationsService.findOne(id, ['*'], '*');
  }
}
