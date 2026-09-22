export interface RegisterAgentDto {
  enrollmentToken: string;
  deviceId: string;
  hostname?: string;
  os?: string;
  osVersion?: string;
  architecture?: string;
  applicationVersion?: string;
  agentVersion?: string;
  // Self-declared by whoever redeems the token — required for a plain/legacy
  // (non-activation-bound) token, since that flow has no other way to know
  // who's actually using the seat. See AgentService.register().
  employeeName?: string;
  employeeEmail?: string;
}

export interface HeartbeatDto {
  agentVersion?: string;
  applicationVersion?: string;
}
