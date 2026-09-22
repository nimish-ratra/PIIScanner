export const TELEMETRY_PING_DEFAULT_INTERVAL_SECONDS = 180;
export const TELEMETRY_PING_MIN_INTERVAL_SECONDS = 60;
export const TELEMETRY_PING_MAX_INTERVAL_SECONDS = 900;

export const COMMAND_EXPIRY_DEFAULT_SECONDS = 86400; // 24 hours
export const COMMAND_REDELIVERY_TIMEOUT_SECONDS = 600; // 10 minutes

export const ALLOWED_COMMAND_TYPES = [
  'force_policy_refresh',
  'request_diagnostic_snapshot',
  'request_service_restart',
] as const;

export type AllowedCommandType = (typeof ALLOWED_COMMAND_TYPES)[number];

export const ALLOWED_COMMAND_RESULTS = ['success', 'failed', 'unsupported'] as const;
export type AllowedCommandResult = (typeof ALLOWED_COMMAND_RESULTS)[number];

export const RETENTION_SERVICE_STATUS_DAYS = 30;
export const RETENTION_ENFORCEMENT_DAYS = 180;
