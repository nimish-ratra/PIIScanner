import { describe, it, expect } from 'vitest';
import { deriveTelemetryStatus } from '../src/agent-telemetry/derive-telemetry-status.util.js';

describe('deriveTelemetryStatus', () => {
  const baseNow = new Date('2026-09-21T12:00:00Z');

  it('returns DISABLED when company telemetryEnabled is false regardless of other fields', () => {
    expect(
      deriveTelemetryStatus({
        telemetryEnabled: false,
        serverTime: new Date('2026-09-21T11:59:00Z'),
        serviceRunning: true,
        now: baseNow,
      }),
    ).toBe('DISABLED');

    expect(
      deriveTelemetryStatus({
        telemetryEnabled: false,
        serverTime: null,
        serviceRunning: false,
        now: baseNow,
      }),
    ).toBe('DISABLED');
  });

  it('returns NO_DATA when serverTime is null', () => {
    expect(
      deriveTelemetryStatus({
        telemetryEnabled: true,
        serverTime: null,
        serviceRunning: false,
        now: baseNow,
      }),
    ).toBe('NO_DATA');
  });

  it('returns OFFLINE when last ping was > 30 minutes ago', () => {
    // 31 minutes ago
    const thirtyOneMinAgo = new Date('2026-09-21T11:29:00Z');
    expect(
      deriveTelemetryStatus({
        telemetryEnabled: true,
        serverTime: thirtyOneMinAgo,
        serviceRunning: true,
        now: baseNow,
      }),
    ).toBe('OFFLINE');

    expect(
      deriveTelemetryStatus({
        telemetryEnabled: true,
        serverTime: thirtyOneMinAgo,
        serviceRunning: false,
        now: baseNow,
      }),
    ).toBe('OFFLINE');
  });

  it('returns STOPPED when last ping <= 30 min reported serviceRunning=false', () => {
    // 2 minutes ago, serviceRunning=false
    const twoMinAgo = new Date('2026-09-21T11:58:00Z');
    expect(
      deriveTelemetryStatus({
        telemetryEnabled: true,
        serverTime: twoMinAgo,
        serviceRunning: false,
        now: baseNow,
      }),
    ).toBe('STOPPED');

    // 15 minutes ago, serviceRunning=false
    const fifteenMinAgo = new Date('2026-09-21T11:45:00Z');
    expect(
      deriveTelemetryStatus({
        telemetryEnabled: true,
        serverTime: fifteenMinAgo,
        serviceRunning: false,
        now: baseNow,
      }),
    ).toBe('STOPPED');
  });

  it('returns LIVE when last ping <= 2 * interval and serviceRunning=true', () => {
    // interval = 180s (3 min) -> 2 * interval = 360s (6 min)
    // 2 minutes ago, serviceRunning=true
    const twoMinAgo = new Date('2026-09-21T11:58:00Z');
    expect(
      deriveTelemetryStatus({
        telemetryEnabled: true,
        serverTime: twoMinAgo,
        serviceRunning: true,
        intervalSeconds: 180,
        now: baseNow,
      }),
    ).toBe('LIVE');

    // Exactly 6 minutes ago (360s)
    const sixMinAgo = new Date('2026-09-21T11:54:00Z');
    expect(
      deriveTelemetryStatus({
        telemetryEnabled: true,
        serverTime: sixMinAgo,
        serviceRunning: true,
        intervalSeconds: 180,
        now: baseNow,
      }),
    ).toBe('LIVE');
  });

  it('returns STALE when last ping > 2 * interval and <= 30 min (and serviceRunning=true)', () => {
    // 7 minutes ago (> 6 min, <= 30 min)
    const sevenMinAgo = new Date('2026-09-21T11:53:00Z');
    expect(
      deriveTelemetryStatus({
        telemetryEnabled: true,
        serverTime: sevenMinAgo,
        serviceRunning: true,
        intervalSeconds: 180,
        now: baseNow,
      }),
    ).toBe('STALE');

    // 29 minutes ago
    const twentyNineMinAgo = new Date('2026-09-21T11:31:00Z');
    expect(
      deriveTelemetryStatus({
        telemetryEnabled: true,
        serverTime: twentyNineMinAgo,
        serviceRunning: true,
        intervalSeconds: 180,
        now: baseNow,
      }),
    ).toBe('STALE');
  });
});
