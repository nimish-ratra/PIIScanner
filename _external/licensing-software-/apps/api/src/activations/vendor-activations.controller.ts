import { Controller, Get, Post, Param, Request } from '@nestjs/common';
import { ActivationsService } from './activations.service.js';
import { RequirePermissions } from '../auth/permissions.decorator.js';

/**
 * Vendor-side Activation visibility + lifecycle control, global across every
 * customer. Unlike VendorInstallationsController (deliberately read-only —
 * see its doc comment), Activation lifecycle management IS exposed here:
 * vendor support/operations staff need to be able to suspend or revoke a
 * specific employee's license right directly (e.g. a support escalation or
 * security incident) without waiting on, or logging in as, that customer's
 * own admin. This does not change who can ISSUE an Activation — that
 * remains exclusively an automatic consequence of a Customer Admin's
 * approval (see ActivationsService.createFromApprovedRequest); this
 * controller only ever manages the lifecycle of an Activation that already
 * exists.
 */
@Controller('vendor/activations')
export class VendorActivationsController {
  constructor(private readonly activationsService: ActivationsService) {}

  @Get()
  @RequirePermissions('*')
  async findAll() {
    return this.activationsService.findAll(['*']);
  }

  @Get(':id')
  @RequirePermissions('*')
  async findOne(@Param('id') id: string) {
    return this.activationsService.findOne(id, ['*']);
  }

  @Post(':id/suspend')
  @RequirePermissions('*')
  async suspend(@Param('id') id: string, @Request() req: any) {
    return this.activationsService.setStatus(id, ['*'], 'SUSPENDED', req.user.id);
  }

  @Post(':id/reactivate')
  @RequirePermissions('*')
  async reactivate(@Param('id') id: string, @Request() req: any) {
    return this.activationsService.setStatus(id, ['*'], 'ACTIVE', req.user.id);
  }

  @Post(':id/revoke')
  @RequirePermissions('*')
  async revoke(@Param('id') id: string, @Request() req: any) {
    return this.activationsService.setStatus(id, ['*'], 'REVOKED', req.user.id);
  }
}
