import {
  Body,
  Controller,
  Post,
  Request,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Public } from '../auth/public.decorator.js';
import { AgentAuthGuard } from '../agent/agent-auth.guard.js';
import { AgentTelemetryService } from './agent-telemetry.service.js';
import {
  CommandAckDto,
  EnforcementSummaryDto,
  ScanSummaryDto,
  TelemetryPingDto,
  TelemetryPingResponseDto,
} from './agent-telemetry.dto.js';

/**
 * Agent Telemetry Ingestion API.
 * All routes are @Public() to bypass session auth, and protected by AgentAuthGuard.
 * Uses class-validator with whitelist + forbidNonWhitelisted.
 */
@Controller('agent/telemetry')
@Public()
@UseGuards(AgentAuthGuard)
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class AgentTelemetryController {
  constructor(private readonly telemetryService: AgentTelemetryService) {}

  @Post('ping')
  async ping(@Request() req: any, @Body() dto: TelemetryPingDto): Promise<TelemetryPingResponseDto> {
    return this.telemetryService.recordPing(req.installation, dto);
  }

  @Post('scan-summary')
  async scanSummary(@Request() req: any, @Body() dto: ScanSummaryDto) {
    return this.telemetryService.recordScanSummary(req.installation, dto);
  }

  @Post('enforcement-summary')
  async enforcementSummary(@Request() req: any, @Body() dto: EnforcementSummaryDto) {
    return this.telemetryService.recordEnforcementSummary(req.installation, dto);
  }

  @Post('command-ack')
  async commandAck(@Request() req: any, @Body() dto: CommandAckDto) {
    return this.telemetryService.recordCommandAck(req.installation, dto);
  }
}
