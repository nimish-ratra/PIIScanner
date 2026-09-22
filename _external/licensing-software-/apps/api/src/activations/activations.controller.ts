import { Controller, Get, Post, Param, Request } from '@nestjs/common';
import { ActivationsService } from './activations.service.js';
import { RequirePermissions } from '../auth/permissions.decorator.js';

@Controller('customer/activations')
export class ActivationsController {
  constructor(private readonly activationsService: ActivationsService) {}

  @Get()
  @RequirePermissions('activation.read')
  async findAll(@Request() req: any) {
    return this.activationsService.findAll(req.user.allowedCompanyIds, req.user.enterpriseId);
  }

  @Get(':id')
  @RequirePermissions('activation.read')
  async findOne(@Param('id') id: string, @Request() req: any) {
    return this.activationsService.findOne(id, req.user.allowedCompanyIds, req.user.enterpriseId);
  }

  @Post(':id/suspend')
  @RequirePermissions('activation.manage')
  async suspend(@Param('id') id: string, @Request() req: any) {
    return this.activationsService.setStatus(id, req.user.allowedCompanyIds, 'SUSPENDED', req.user.id);
  }

  @Post(':id/reactivate')
  @RequirePermissions('activation.manage')
  async reactivate(@Param('id') id: string, @Request() req: any) {
    return this.activationsService.setStatus(id, req.user.allowedCompanyIds, 'ACTIVE', req.user.id);
  }

  @Post(':id/revoke')
  @RequirePermissions('activation.manage')
  async revoke(@Param('id') id: string, @Request() req: any) {
    return this.activationsService.setStatus(id, req.user.allowedCompanyIds, 'REVOKED', req.user.id);
  }

  /**
   * Device replacement: mints a fresh single-use activation-bound enrollment
   * token for a DEACTIVATED activation (its previous installation was
   * revoked/released). Distinct from `reactivate` (SUSPENDED -> ACTIVE,
   * no new token involved).
   */
  @Post(':id/reactivate-enrollment')
  @RequirePermissions('activation.manage')
  async reactivateEnrollment(@Param('id') id: string, @Request() req: any) {
    return this.activationsService.mintReplacementEnrollmentToken(id, req.user.allowedCompanyIds, req.user.id);
  }
}
