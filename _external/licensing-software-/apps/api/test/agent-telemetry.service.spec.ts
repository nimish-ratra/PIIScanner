import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentTelemetryService } from '../src/agent-telemetry/agent-telemetry.service.js';
import { ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';

describe('AgentTelemetryService Unit Tests', () => {
  let service: AgentTelemetryService;
  let mockPrisma: any;
  let mockAudit: any;

  const mockActiveInstallation = {
    id: 'inst-1',
    companyId: 'comp-acme-1',
    status: 'ACTIVE',
    company: {
      id: 'comp-acme-1',
      telemetryEnabled: true,
      syncFullPaths: false,
    },
  };

  const mockRevokedInstallation = {
    id: 'inst-revoked',
    companyId: 'comp-acme-1',
    status: 'REVOKED',
    company: {
      id: 'comp-acme-1',
      telemetryEnabled: true,
      syncFullPaths: false,
    },
  };

  const mockSuspendedInstallation = {
    id: 'inst-suspended',
    companyId: 'comp-acme-1',
    status: 'SUSPENDED',
    company: {
      id: 'comp-acme-1',
      telemetryEnabled: true,
      syncFullPaths: false,
    },
  };

  beforeEach(() => {
    mockPrisma = {
      installationTelemetryState: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      serviceStatusEvent: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      agentCommand: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation((args: any) => Promise.resolve({ id: 'cmd-1', ...args.data })),
        update: vi.fn().mockImplementation((args: any) => Promise.resolve({ id: args.where.id, ...args.data })),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      scanRun: {
        upsert: vi.fn().mockImplementation((args: any) => Promise.resolve({ id: 'scan-run-1', ...args.create })),
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
      },
      scanFindingSummary: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      enforcementWindow: {
        upsert: vi.fn().mockImplementation((args: any) => Promise.resolve({ id: 'ew-1', ...args.create })),
        findMany: vi.fn().mockResolvedValue([]),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      company: {
        findUnique: vi.fn().mockResolvedValue({
          telemetryEnabled: true,
          syncFullPaths: false,
        }),
      },
      installation: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    mockAudit = {
      logEvent: vi.fn().mockResolvedValue(undefined),
    };

    service = new AgentTelemetryService(mockPrisma, mockAudit);
  });

  describe('recordPing', () => {
    it('rejects REVOKED installations with 403 ForbiddenException', async () => {
      await expect(
        service.recordPing(mockRevokedInstallation as any, {
          clientTime: new Date().toISOString(),
          serviceRunning: true,
          watcherActive: true,
          agentVersion: '1.0.0',
          applicationVersion: '1.0.0',
          outboxDepth: 0,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('accepts pings from non-revoked (SUSPENDED) installation and returns live state', async () => {
      const response = await service.recordPing(mockSuspendedInstallation as any, {
        clientTime: new Date().toISOString(),
        serviceRunning: false,
        watcherActive: false,
        agentVersion: '1.0.0',
        applicationVersion: '1.0.0',
        outboxDepth: 0,
      });

      expect(response).toBeDefined();
      expect(response.installationStatus).toBe('SUSPENDED');
      expect(response.telemetry.enabled).toBe(true);
      expect(mockPrisma.installationTelemetryState.upsert).toHaveBeenCalled();
    });

    it('reflects company telemetryEnabled=false in ping response', async () => {
      mockPrisma.company.findUnique.mockResolvedValueOnce({
        telemetryEnabled: false,
        syncFullPaths: false,
      });

      const response = await service.recordPing(mockActiveInstallation as any, {
        clientTime: new Date().toISOString(),
        serviceRunning: true,
        watcherActive: true,
        agentVersion: '1.0.0',
        applicationVersion: '1.0.0',
        outboxDepth: 0,
      });

      expect(response.telemetry.enabled).toBe(false);
    });

    it('delivers pending commands in ping response and marks them DELIVERED', async () => {
      const pendingCmd = {
        id: 'cmd-uuid',
        commandType: 'force_policy_refresh',
        issuedAt: new Date(),
        expiresAt: new Date(Date.now() + 86400000),
        status: 'PENDING',
      };
      mockPrisma.agentCommand.findMany.mockResolvedValueOnce([pendingCmd]);

      const response = await service.recordPing(mockActiveInstallation as any, {
        clientTime: new Date().toISOString(),
        serviceRunning: true,
        watcherActive: true,
        agentVersion: '1.0.0',
        applicationVersion: '1.0.0',
        outboxDepth: 0,
      });

      expect(response.commands.length).toBe(1);
      expect(response.commands[0].type).toBe('force_policy_refresh');
      expect(mockPrisma.agentCommand.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: ['cmd-uuid'] } },
          data: expect.objectContaining({ status: 'DELIVERED' }),
        }),
      );
    });
  });

  describe('recordScanSummary', () => {
    it('rejects scan summary if installation is not ACTIVE', async () => {
      await expect(
        service.recordScanSummary(mockSuspendedInstallation as any, {
          clientScanId: '550e8400-e29b-41d4-a716-446655440000',
          scanSource: 'directory_scan',
          startedAt: new Date().toISOString(),
          status: 'completed',
          durationSeconds: 10,
          filesScanned: 100,
          filesWithPii: 5,
          totalFindings: 10,
          filesTruncated: false,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('upserts scan summary idempotently by (installationId, clientScanId)', async () => {
      const dto = {
        clientScanId: '550e8400-e29b-41d4-a716-446655440000',
        scanSource: 'directory_scan' as const,
        startedAt: new Date().toISOString(),
        status: 'completed' as const,
        durationSeconds: 15,
        filesScanned: 50,
        filesWithPii: 2,
        totalFindings: 4,
        filesTruncated: false,
        files: [
          {
            pathRef: 'sha256:abc123',
            tier: 'Confidential',
            entityTypeCounts: { EMAIL_ADDRESS: 2 },
            watermarkStatus: 'APPLIED' as const,
          },
        ],
      };

      const res = await service.recordScanSummary(mockActiveInstallation as any, dto);
      expect(res.success).toBe(true);
      expect(mockPrisma.scanRun.upsert).toHaveBeenCalled();
      expect(mockPrisma.scanFindingSummary.deleteMany).toHaveBeenCalled();
      expect(mockPrisma.scanFindingSummary.createMany).toHaveBeenCalled();
    });
  });

  describe('recordEnforcementSummary', () => {
    it('rejects enforcement summary if installation is not ACTIVE', async () => {
      await expect(
        service.recordEnforcementSummary(mockSuspendedInstallation as any, {
          windows: [],
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('upserts enforcement windows idempotently', async () => {
      const now = new Date();
      const res = await service.recordEnforcementSummary(mockActiveInstallation as any, {
        windows: [
          {
            windowStart: now.toISOString(),
            windowEnd: new Date(now.getTime() + 15 * 60 * 1000).toISOString(),
            source: 'Filesystem Watcher',
            actionCounts: { block: 1 },
            tierCounts: { Restricted: 1 },
            overrideCount: 0,
          },
        ],
      });

      expect(res.success).toBe(true);
      expect(res.count).toBe(1);
      expect(mockPrisma.enforcementWindow.upsert).toHaveBeenCalled();
    });
  });

  describe('recordCommandAck', () => {
    it('throws NotFoundException if command does not belong to installation', async () => {
      mockPrisma.agentCommand.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.recordCommandAck(mockActiveInstallation as any, {
          commandId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
          result: 'success',
          detail: 'Done',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('acknowledges command and records audit event', async () => {
      mockPrisma.agentCommand.findFirst.mockResolvedValueOnce({
        id: 'cmd-1',
        installationId: 'inst-1',
        commandType: 'request_service_restart',
      });

      const res = await service.recordCommandAck(mockActiveInstallation as any, {
        commandId: 'cmd-1',
        result: 'success',
        detail: 'Restarted cleanly',
      });

      expect(res.success).toBe(true);
      expect(mockPrisma.agentCommand.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'cmd-1' },
          data: expect.objectContaining({
            status: 'ACKNOWLEDGED',
            result: 'success',
          }),
        }),
      );
      expect(mockAudit.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'AGENT_COMMAND_ACKNOWLEDGED' }),
      );
    });
  });

  describe('Tenant Isolation on Admin Endpoints', () => {
    it('getInstallationTelemetry rejects cross-company access with NotFoundException', async () => {
      // Company A admin only has allowedCompanyIds = ['comp-acme-1']
      // Installation belongs to comp-globex-2
      mockPrisma.installation.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.getInstallationTelemetry('inst-globex-1', ['comp-acme-1']),
      ).rejects.toThrow(NotFoundException);
    });

    it('issueCommand rejects cross-company command issuance with NotFoundException', async () => {
      mockPrisma.installation.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.issueCommand('inst-globex-1', 'force_policy_refresh', 'user-1', ['comp-acme-1']),
      ).rejects.toThrow(NotFoundException);
    });

    it('cancelCommand rejects cross-company command cancellation with NotFoundException', async () => {
      mockPrisma.agentCommand.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.cancelCommand('inst-globex-1', 'cmd-globex-1', 'user-1', ['comp-acme-1']),
      ).rejects.toThrow(NotFoundException);
    });

    it('prevents cancelling an already acknowledged command', async () => {
      mockPrisma.agentCommand.findFirst.mockResolvedValueOnce({
        id: 'cmd-1',
        installationId: 'inst-1',
        status: 'ACKNOWLEDGED',
      });

      await expect(
        service.cancelCommand('inst-1', 'cmd-1', 'user-1', ['comp-acme-1']),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('Vendor Fleet Health Rollup (Privacy Preserving)', () => {
    it('returns cross-company statistics with zero finding details', async () => {
      mockPrisma.installation.findMany.mockResolvedValueOnce([
        {
          id: 'inst-1',
          companyId: 'comp-1',
          agentVersion: '1.0.0',
          telemetryState: {
            lastPingAt: new Date(),
            serviceRunning: true,
            agentVersion: '1.0.0',
          },
          company: {
            id: 'comp-1',
            name: 'Acme Corp',
            telemetryEnabled: true,
          },
        },
        {
          id: 'inst-2',
          companyId: 'comp-2',
          agentVersion: '1.0.0',
          telemetryState: {
            lastPingAt: new Date(Date.now() - 60 * 60 * 1000), // 1h ago -> OFFLINE
            serviceRunning: false,
            agentVersion: '1.0.0',
          },
          company: {
            id: 'comp-2',
            name: 'Globex Inc',
            telemetryEnabled: true,
          },
        },
      ]);

      const result = await service.getVendorFleetHealth();

      expect(result.totalInstallations).toBe(2);
      expect(result.statusCounts.LIVE).toBe(1);
      expect(result.statusCounts.OFFLINE).toBe(1);
      expect(result.companyRollups).toHaveLength(2);
      expect(result.agentVersionDistribution['1.0.0']).toBe(2);

      // Verify privacy invariants: NO findings, paths, or entity types in the vendor output
      const jsonStr = JSON.stringify(result);
      expect(jsonStr).not.toContain('findings');
      expect(jsonStr).not.toContain('pathRef');
      expect(jsonStr).not.toContain('entityType');
    });
  });
});
