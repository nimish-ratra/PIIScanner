import { Body, Controller, Get, Param, Patch, Post, Put, Request, UsePipes, ValidationPipe } from '@nestjs/common';
import { CompaniesService } from './companies.service.js';
import { RequirePermissions } from '../auth/permissions.decorator.js';
import { UpdateTelemetrySettingsDto } from '../agent-telemetry/agent-telemetry.dto.js';
import { UpdateCloudConnectorConfigDto } from './cloud-connector.dto.js';

@Controller('customer/companies')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

  @Get()
  @RequirePermissions('company.read')
  async findAll(@Request() req: any) {
    return this.companiesService.findAll(req.user.allowedCompanyIds);
  }

  @Get(':id')
  @RequirePermissions('company.read')
  async findOne(@Param('id') id: string, @Request() req: any) {
    return this.companiesService.findOne(id, req.user.allowedCompanyIds);
  }

  @Patch(':id/email-domains')
  @RequirePermissions('company.manage')
  async setAllowedEmailDomains(
    @Param('id') id: string,
    @Body('allowedEmailDomains') allowedEmailDomains: string[],
    @Request() req: any,
  ) {
    return this.companiesService.setAllowedEmailDomains(id, allowedEmailDomains, req.user.allowedCompanyIds, req.user.id);
  }

  @Patch(':id/telemetry-settings')
  @RequirePermissions('company.manage')
  async updateTelemetrySettings(
    @Param('id') id: string,
    @Body() dto: UpdateTelemetrySettingsDto,
    @Request() req: any,
  ) {
    return this.companiesService.updateTelemetrySettings(
      id,
      dto,
      req.user.allowedCompanyIds,
      req.user.id,
    );
  }

  @Get(':id/o365-connector')
  @RequirePermissions('company.read')
  async getCloudConnectorConfig(@Param('id') id: string, @Request() req: any) {
    return this.companiesService.getCloudConnectorConfig(id, req.user.allowedCompanyIds);
  }

  @Put(':id/o365-connector')
  @RequirePermissions('company.manage')
  async updateCloudConnectorConfig(
    @Param('id') id: string,
    @Body() dto: UpdateCloudConnectorConfigDto,
    @Request() req: any,
  ) {
    return this.companiesService.updateCloudConnectorConfig(
      id,
      dto,
      req.user.allowedCompanyIds,
      req.user.id,
    );
  }

  @Post(':id/o365-connector/sync')
  @RequirePermissions('company.manage')
  async triggerCloudConnectorSync(@Param('id') id: string, @Request() req: any) {
    return this.companiesService.triggerCloudConnectorSync(
      id,
      req.user.allowedCompanyIds,
      req.user.id,
    );
  }
}


