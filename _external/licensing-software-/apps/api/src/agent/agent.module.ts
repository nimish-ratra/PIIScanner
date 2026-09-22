import { Module } from '@nestjs/common';
import { AgentController } from './agent.controller.js';
import { AgentService } from './agent.service.js';
import { AgentAuthGuard } from './agent-auth.guard.js';
import { ActivationsModule } from '../activations/activations.module.js';

@Module({
  imports: [ActivationsModule],
  controllers: [AgentController],
  providers: [AgentService, AgentAuthGuard],
})
export class AgentModule {}
