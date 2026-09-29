import { Controller, Get, Param, Post } from '@nestjs/common';
import { CloudDeltaSyncService } from './sync/cloud-delta-sync.service.js';

@Controller()
export class AppController {
  constructor(private readonly deltaSyncService: CloudDeltaSyncService) {}

  @Get('health')
  getHealth() {
    return {
      status: 'ok',
      service: 'clAIssify-o365-cloud-connector',
      version: '1.1.0',
      timestamp: new Date().toISOString(),
    };
  }

  @Post('sync/:companyId')
  async triggerSync(@Param('companyId') companyId: string) {
    const result = await this.deltaSyncService.syncCompany(companyId);
    return {
      status: 'success',
      companyId,
      result,
    };
  }
}
