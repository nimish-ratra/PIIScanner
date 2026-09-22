import { Body, Controller, Get, Post, Request, UseGuards } from '@nestjs/common';
import { Public } from '../auth/public.decorator.js';
import { AgentAuthGuard } from './agent-auth.guard.js';
import { AgentService } from './agent.service.js';
import type { HeartbeatDto, RegisterAgentDto } from './agent.dto.js';

/**
 * Agent Protocol — see docs/agent-protocol.md.
 *
 * Agent principals (a single Installation) are never session/OIDC-authenticated,
 * so this whole controller is @Public() to bypass the global session-based
 * AuthGuard/TenantGuard/PermissionsGuard. AgentAuthGuard is applied explicitly
 * on every route except register, which authenticates via the enrollment
 * token in its body instead of an installation credential.
 */
@Controller('agent')
@Public()
export class AgentController {
  constructor(private readonly agentService: AgentService) {}

  @Post('register')
  async register(@Body() dto: RegisterAgentDto) {
    return this.agentService.register(dto);
  }

  @Post('heartbeat')
  @UseGuards(AgentAuthGuard)
  async heartbeat(@Request() req: any, @Body() dto: HeartbeatDto) {
    return this.agentService.heartbeat(req.installation, dto ?? {});
  }

  @Get('policy')
  @UseGuards(AgentAuthGuard)
  async policy(@Request() req: any) {
    return this.agentService.getPolicy(req.installation);
  }

  @Post('release')
  @UseGuards(AgentAuthGuard)
  async release(@Request() req: any) {
    return this.agentService.release(req.installation);
  }
}
