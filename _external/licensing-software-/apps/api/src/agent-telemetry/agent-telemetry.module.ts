import { Module } from '@nestjs/common';
import { AgentTelemetryController } from './agent-telemetry.controller.js';
import { CustomerTelemetryController } from './customer-telemetry.controller.js';
import { VendorTelemetryController } from './vendor-telemetry.controller.js';
import { AgentTelemetryService } from './agent-telemetry.service.js';
import { AgentAuthGuard } from '../agent/agent-auth.guard.js';

@Module({
  controllers: [
    AgentTelemetryController,
    CustomerTelemetryController,
    VendorTelemetryController,
  ],
  providers: [AgentTelemetryService, AgentAuthGuard],
  exports: [AgentTelemetryService],
})
export class AgentTelemetryModule {}
