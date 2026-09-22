import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Request,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { RequirePermissions } from '../auth/permissions.decorator.js';
import { AgentTelemetryService } from './agent-telemetry.service.js';
import { IssueCommandDto } from './agent-telemetry.dto.js';

import { AllowedCommandType } from './agent-telemetry.constants.js';

/**
 * Customer Portal Admin Telemetry Controller.
 * Session-authenticated and RBAC/tenant-scoped.
 */
@Controller('customer')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class CustomerTelemetryController {
  constructor(private readonly telemetryService: AgentTelemetryService) {}

  /**
   * Returns live state, derived status, scans, enforcement, and commands for an installation.
   */
  @Get('installations/:id/telemetry')
  @RequirePermissions('installation.read')
  async getInstallationTelemetry(@Param('id') id: string, @Request() req: any) {
    return this.telemetryService.getInstallationTelemetry(id, req.user.allowedCompanyIds);
  }

  /**
   * Returns scan run detail with capped per-file findings.
   */
  @Get('installations/:id/scans/:scanRunId')
  @RequirePermissions('installation.read')
  async getScanDetail(
    @Param('id') id: string,
    @Param('scanRunId') scanRunId: string,
    @Request() req: any,
  ) {
    return this.telemetryService.getScanDetail(id, scanRunId, req.user.allowedCompanyIds);
  }

  /**
   * Fleet-level KPIs and summaries.
   */
  @Get('telemetry/summary')
  @RequirePermissions('installation.read')
  async getTelemetrySummary(
    @Request() req: any,
    @Query('companyId') companyId?: string,
    @Query('days') days?: string,
  ) {
    const daysNum = days ? parseInt(days, 10) || 7 : 7;
    const scopedCompanies = companyId
      ? req.user.allowedCompanyIds.includes('*') || req.user.allowedCompanyIds.includes(companyId)
        ? [companyId]
        : []
      : req.user.allowedCompanyIds;

    return this.telemetryService.getTelemetrySummary(scopedCompanies, daysNum);
  }

  /**
   * Fleet table rows with filtering, search, pagination, and derived status.
   */
  @Get('telemetry/installations')
  @RequirePermissions('installation.read')
  async getFleetInstallations(
    @Request() req: any,
    @Query('companyId') companyId?: string,
    @Query('status') status?: string,
    @Query('tier') tier?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.telemetryService.getFleetInstallations(req.user.allowedCompanyIds, {
      companyId,
      status,
      tier,
      search,
      page: page ? parseInt(page, 10) : 1,
      pageSize: pageSize ? parseInt(pageSize, 10) : 20,
    });
  }

  /**
   * Issues a command to an installation.
   */
  @Post('installations/:id/commands')
  @RequirePermissions('installation.manage')
  async issueCommand(
    @Param('id') id: string,
    @Body() dto: IssueCommandDto,
    @Request() req: any,
  ) {
    return this.telemetryService.issueCommand(
      id,
      dto.commandType as AllowedCommandType,
      req.user.id,
      req.user.allowedCompanyIds,
    );
  }

  /**
   * Cancels a pending/delivered command.
   */
  @Delete('installations/:id/commands/:commandId')
  @RequirePermissions('installation.manage')
  async cancelCommand(
    @Param('id') id: string,
    @Param('commandId') commandId: string,
    @Request() req: any,
  ) {
    return this.telemetryService.cancelCommand(
      id,
      commandId,
      req.user.id,
      req.user.allowedCompanyIds,
    );
  }
}
