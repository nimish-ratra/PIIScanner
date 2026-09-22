import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import {
  ScanSummaryDto,
  TelemetryPingDto,
  EnforcementSummaryDto,
  CommandAckDto,
  IssueCommandDto,
  UpdateTelemetrySettingsDto,
} from '../src/agent-telemetry/agent-telemetry.dto.js';

describe('Agent Telemetry DTO Validation & Firewall', () => {
  describe('TelemetryPingDto', () => {
    it('validates a valid ping payload', async () => {
      const plain = {
        clientTime: new Date().toISOString(),
        serviceRunning: true,
        watcherActive: true,
        serviceStartedAt: new Date().toISOString(),
        policyHash: '1a2b3c4d5e6f',
        agentVersion: '1.0.0',
        applicationVersion: '1.0.0',
        outboxDepth: 0,
      };
      const dto = plainToInstance(TelemetryPingDto, plain);
      const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
      expect(errors.length).toBe(0);
    });

    it('rejects invalid policyHash format', async () => {
      const plain = {
        clientTime: new Date().toISOString(),
        serviceRunning: true,
        watcherActive: true,
        policyHash: 'not-a-12-hex-hash-too-long',
        agentVersion: '1.0.0',
        applicationVersion: '1.0.0',
        outboxDepth: 0,
      };
      const dto = plainToInstance(TelemetryPingDto, plain);
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('policyHash');
    });

    it('rejects negative outboxDepth', async () => {
      const plain = {
        clientTime: new Date().toISOString(),
        serviceRunning: true,
        watcherActive: true,
        agentVersion: '1.0.0',
        applicationVersion: '1.0.0',
        outboxDepth: -5,
      };
      const dto = plainToInstance(TelemetryPingDto, plain);
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('outboxDepth');
    });
  });

  describe('ScanSummaryDto', () => {
    it('validates a valid scan summary', async () => {
      const plain = {
        clientScanId: '550e8400-e29b-41d4-a716-446655440000',
        scanSource: 'directory_scan',
        targetSummary: 'C:, D:',
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        status: 'completed',
        durationSeconds: 120,
        filesScanned: 10,
        filesWithPii: 2,
        totalFindings: 5,
        highestTier: 'Confidential',
        tierCounts: { Confidential: 2, General: 3 },
        entityTypeTotals: { EMAIL_ADDRESS: 3, CREDIT_CARD_NUMBER: 2 },
        files: [
          {
            pathRef: 'sha256:1234567890abcdef',
            tier: 'Confidential',
            entityTypeCounts: { EMAIL_ADDRESS: 1 },
            watermarkStatus: 'APPLIED',
          },
        ],
        filesTruncated: false,
      };
      const dto = plainToInstance(ScanSummaryDto, plain);
      const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
      expect(errors.length).toBe(0);
    });

    it('rejects tierCounts with more than 5 keys', async () => {
      const plain = {
        clientScanId: '550e8400-e29b-41d4-a716-446655440000',
        scanSource: 'directory_scan',
        startedAt: new Date().toISOString(),
        status: 'completed',
        durationSeconds: 10,
        filesScanned: 10,
        filesWithPii: 1,
        totalFindings: 1,
        tierCounts: {
          Tier1: 1,
          Tier2: 2,
          Tier3: 3,
          Tier4: 4,
          Tier5: 5,
          Tier6: 6, // 6th key violates <= 5
        },
        filesTruncated: false,
      };
      const dto = plainToInstance(ScanSummaryDto, plain);
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('tierCounts');
    });

    it('rejects entityTypeTotals with invalid key regex', async () => {
      const plain = {
        clientScanId: '550e8400-e29b-41d4-a716-446655440000',
        scanSource: 'directory_scan',
        startedAt: new Date().toISOString(),
        status: 'completed',
        durationSeconds: 10,
        filesScanned: 10,
        filesWithPii: 1,
        totalFindings: 1,
        entityTypeTotals: {
          'invalid key with spaces!': 1,
        },
        filesTruncated: false,
      };
      const dto = plainToInstance(ScanSummaryDto, plain);
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('entityTypeTotals');
    });

    it('rejects entityTypeTotals with non-integer counts', async () => {
      const plain = {
        clientScanId: '550e8400-e29b-41d4-a716-446655440000',
        scanSource: 'directory_scan',
        startedAt: new Date().toISOString(),
        status: 'completed',
        durationSeconds: 10,
        filesScanned: 10,
        filesWithPii: 1,
        totalFindings: 1,
        entityTypeTotals: {
          EMAIL_ADDRESS: 2.5, // float violates integer
        },
        filesTruncated: false,
      };
      const dto = plainToInstance(ScanSummaryDto, plain);
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('entityTypeTotals');
    });

    it('rejects invalid scanSource', async () => {
      const plain = {
        clientScanId: '550e8400-e29b-41d4-a716-446655440000',
        scanSource: 'unauthorized_source',
        startedAt: new Date().toISOString(),
        status: 'completed',
        durationSeconds: 10,
        filesScanned: 10,
        filesWithPii: 1,
        totalFindings: 1,
        filesTruncated: false,
      };
      const dto = plainToInstance(ScanSummaryDto, plain);
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('scanSource');
    });
  });

  describe('EnforcementSummaryDto', () => {
    it('validates 15-minute enforcement windows', async () => {
      const plain = {
        windows: [
          {
            windowStart: new Date().toISOString(),
            windowEnd: new Date().toISOString(),
            source: 'Filesystem Watcher',
            actionCounts: { block: 1, allow: 10 },
            tierCounts: { Restricted: 1 },
            overrideCount: 0,
          },
        ],
      };
      const dto = plainToInstance(EnforcementSummaryDto, plain);
      const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
      expect(errors.length).toBe(0);
    });

    it('rejects unknown source in enforcement window', async () => {
      const plain = {
        windows: [
          {
            windowStart: new Date().toISOString(),
            windowEnd: new Date().toISOString(),
            source: 'UnknownApp',
            actionCounts: {},
            tierCounts: {},
            overrideCount: 0,
          },
        ],
      };
      const dto = plainToInstance(EnforcementSummaryDto, plain);
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe('CommandAckDto & IssueCommandDto', () => {
    it('validates command acknowledgement with allowed result', async () => {
      const plain = {
        commandId: '550e8400-e29b-41d4-a716-446655440000',
        result: 'success',
        detail: 'OK',
      };
      const dto = plainToInstance(CommandAckDto, plain);
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('rejects invalid command ack result', async () => {
      const plain = {
        commandId: '550e8400-e29b-41d4-a716-446655440000',
        result: 'partial_success', // not in allowed
      };
      const dto = plainToInstance(CommandAckDto, plain);
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('validates allowed command types on IssueCommandDto', async () => {
      const valid = plainToInstance(IssueCommandDto, { commandType: 'force_policy_refresh' });
      expect((await validate(valid)).length).toBe(0);

      const invalid = plainToInstance(IssueCommandDto, { commandType: 'execute_shell_script' });
      expect((await validate(invalid)).length).toBeGreaterThan(0);
    });
  });

  describe('UpdateTelemetrySettingsDto', () => {
    it('validates boolean settings toggles', async () => {
      const dto = plainToInstance(UpdateTelemetrySettingsDto, {
        telemetryEnabled: false,
        syncFullPaths: true,
      });
      const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
      expect(errors.length).toBe(0);
    });
  });
});
