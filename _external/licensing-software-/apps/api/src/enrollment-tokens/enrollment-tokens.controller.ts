import { Body, Controller, ForbiddenException, Get, Param, Post, Request } from '@nestjs/common';
import { EnrollmentTokensService } from './enrollment-tokens.service.js';
import { RequirePermissions } from '../auth/permissions.decorator.js';
import type { BulkCreateEnrollmentTokenDto, CreateEnrollmentTokenDto } from './enrollment-tokens.dto.js';

@Controller('customer/companies/:companyId/enrollment-tokens')
export class EnrollmentTokensController {
  constructor(private readonly enrollmentTokensService: EnrollmentTokensService) {}

  @Post()
  @RequirePermissions('installation.enroll')
  async create(@Param('companyId') companyId: string, @Body() dto: CreateEnrollmentTokenDto, @Request() req: any) {
    this.assertCompanyAccess(req, companyId);
    return this.enrollmentTokensService.create(companyId, dto, req.user.id);
  }

  @Post('bulk')
  @RequirePermissions('installation.enroll')
  async createBulk(
    @Param('companyId') companyId: string,
    @Body() dto: BulkCreateEnrollmentTokenDto,
    @Request() req: any,
  ) {
    this.assertCompanyAccess(req, companyId);
    return this.enrollmentTokensService.createBulk(companyId, dto, req.user.id);
  }

  @Get()
  @RequirePermissions('installation.enroll')
  async findAll(@Param('companyId') companyId: string, @Request() req: any) {
    this.assertCompanyAccess(req, companyId);
    return this.enrollmentTokensService.findAll(companyId);
  }

  @Post(':id/revoke')
  @RequirePermissions('installation.enroll')
  async revoke(@Param('companyId') companyId: string, @Param('id') id: string, @Request() req: any) {
    this.assertCompanyAccess(req, companyId);
    return this.enrollmentTokensService.revoke(id, companyId, req.user.id);
  }

  private assertCompanyAccess(req: any, companyId: string): void {
    if (!req.user.allowedCompanyIds.includes('*') && !req.user.allowedCompanyIds.includes(companyId)) {
      throw new ForbiddenException('Cannot manage enrollment tokens for an unauthorized company');
    }
  }
}
