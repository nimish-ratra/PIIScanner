import { TELEMETRY_PING_DEFAULT_INTERVAL_SECONDS } from './agent-telemetry.constants.js';

export type TelemetryStatus = 'NO_DATA' | 'LIVE' | 'STOPPED' | 'STALE' | 'OFFLINE' | 'DISABLED';

export interface DeriveTelemetryStatusParams {
  telemetryEnabled: boolean;
  serverTime: Date | string | null;
  serviceRunning: boolean;
  intervalSeconds?: number;
  now?: Date;
}

/**
 * Pure function to derive live telemetry status without depending on client clocks.
 *
 * Rules (§4):
 * - DISABLED: company turned telemetry off (telemetryEnabled is false)
 * - NO_DATA: never pinged (serverTime is null)
 * - OFFLINE: > 30 min since last ping
 * - STOPPED: last ping reported serviceRunning=false (within 30 min)
 * - LIVE: last ping <= 2 * interval and serviceRunning
 * - STALE: > 2 * interval but <= 30 min since last ping (and service was running)
 */
export function deriveTelemetryStatus(params: DeriveTelemetryStatusParams): TelemetryStatus {
  if (!params.telemetryEnabled) {
    return 'DISABLED';
  }

  if (!params.serverTime) {
    return 'NO_DATA';
  }

  const nowMs = params.now ? params.now.getTime() : Date.now();
  const serverTimeMs = new Date(params.serverTime).getTime();
  const elapsedSeconds = Math.max(0, (nowMs - serverTimeMs) / 1000);
  const intervalSeconds = params.intervalSeconds ?? TELEMETRY_PING_DEFAULT_INTERVAL_SECONDS;

  if (elapsedSeconds > 30 * 60) {
    return 'OFFLINE';
  }

  if (!params.serviceRunning) {
    return 'STOPPED';
  }

  if (elapsedSeconds <= 2 * intervalSeconds) {
    return 'LIVE';
  }

  return 'STALE';
}
