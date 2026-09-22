import { Controller, Get, UsePipes, ValidationPipe } from '@nestjs/common';
import { AgentTelemetryService } from './agent-telemetry.service.js';
import { RequirePermissions } from '../auth/permissions.decorator.js';

@Controller('vendor/telemetry')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class VendorTelemetryController {
  constructor(private readonly telemetryService: AgentTelemetryService) {}

  /**
   * Cross-company fleet health rollup for TrustFabric staff.
   * STRICT PRIVACY INVARIANT: Zero findings, zero file names, zero entity types.
   */
  @Get('fleet-health')
  @RequirePermissions('*')
  async getFleetHealth() {
    return this.telemetryService.getVendorFleetHealth();
  }
}
