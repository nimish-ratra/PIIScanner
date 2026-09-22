import { Controller, Get, Request, Query } from '@nestjs/common';
import { AuditService } from './audit.service.js';
import { RequirePermissions } from '../auth/permissions.decorator.js';

@Controller('customer/audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @RequirePermissions('audit.read')
  async getAuditLogs(
    @Request() req: any,
    @Query('companyId') companyId?: string,
    @Query('actorId') actorId?: string,
    @Query('action') action?: string,
    @Query('targetType') targetType?: string,
    @Query('result') result?: string,
    @Query('limit') limit: string = '50',
    @Query('offset') offset: string = '0'
  ) {
    return this.auditService.findAll(req.user.allowedCompanyIds, {
      companyId, actorId, action, targetType, result,
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10)
    });
  }
}
