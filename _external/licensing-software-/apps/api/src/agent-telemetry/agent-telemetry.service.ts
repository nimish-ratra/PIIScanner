import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import {
  ALLOWED_COMMAND_TYPES,
  AllowedCommandType,
  COMMAND_EXPIRY_DEFAULT_SECONDS,
  COMMAND_REDELIVERY_TIMEOUT_SECONDS,
  RETENTION_ENFORCEMENT_DAYS,
  RETENTION_SERVICE_STATUS_DAYS,
  TELEMETRY_PING_DEFAULT_INTERVAL_SECONDS,
} from './agent-telemetry.constants.js';
import {
  CommandAckDto,
  EnforcementSummaryDto,
  ScanSummaryDto,
  TelemetryCommandResponseDto,
  TelemetryPingDto,
  TelemetryPingResponseDto,
} from './agent-telemetry.dto.js';
import { deriveTelemetryStatus, TelemetryStatus } from './derive-telemetry-status.util.js';

interface InstallationWithCompany {
  id: string;
  companyId: string;
  status: string;
  company: {
    id: string;
    telemetryEnabled: boolean;
    syncFullPaths: boolean;
  };
}

@Injectable()
export class AgentTelemetryService {
  private readonly logger = new Logger(AgentTelemetryService.name);

  // In-memory rate limiting tracking: installationId -> timestamp[]
  private readonly pingRateLimits = new Map<string, number[]>();
  private readonly summaryRateLimits = new Map<string, number[]>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ─── Rate Limiting Helpers ──────────────────────────────────────────────────

  private checkRateLimit(
    store: Map<string, number[]>,
    key: string,
    limit: number,
    windowMs: number,
  ): boolean {
    const now = Date.now();
    const timestamps = (store.get(key) ?? []).filter((t) => now - t < windowMs);
    if (timestamps.length >= limit) {
      return false;
    }
    timestamps.push(now);
    store.set(key, timestamps);
    return true;
  }

  // ─── Agent Routes ───────────────────────────────────────────────────────────

  /**
   * Records a telemetry ping from an agent.
   * - Rejects REVOKED installations with 403.
   * - Upserts hot row in InstallationTelemetryState.
   * - Appends cold history row in ServiceStatusEvent on state change or >= 15 min.
   * - Gathers pending/unacknowledged commands to return in the response.
   */
  async recordPing(
    installation: InstallationWithCompany,
    dto: TelemetryPingDto,
  ): Promise<TelemetryPingResponseDto> {
    if (installation.status === 'REVOKED') {
      throw new ForbiddenException('Installation is revoked');
    }

    // Rate limiting: ping ~1/min with burst up to 3 per min
    if (!this.checkRateLimit(this.pingRateLimits, installation.id, 3, 60_000)) {
      this.logger.warn(`Rate limit exceeded for ping from installation ${installation.id}`);
      // Don't fail with 429 to avoid agent crash, but clamp processing
    }

    const now = new Date();
    let clientTimeDate: Date | null = null;
    if (dto.clientTime) {
      const parsed = new Date(dto.clientTime);
      // Ignore extreme client clock skew (> 24 hours off)
      if (!isNaN(parsed.getTime()) && Math.abs(now.getTime() - parsed.getTime()) <= 86_400_000) {
        clientTimeDate = parsed;
      }
    }

    // Fetch existing state to detect first-ever ping or status transitions
    const priorState = await this.prisma.installationTelemetryState.findUnique({
      where: { installationId: installation.id },
    });

    // 1. Hot row: Upsert InstallationTelemetryState
    await this.prisma.installationTelemetryState.upsert({
      where: { installationId: installation.id },
      create: {
        installationId: installation.id,
        companyId: installation.companyId,
        clientTime: clientTimeDate,
        serverTime: now,
        serviceRunning: dto.serviceRunning,
        watcherActive: dto.watcherActive,
        serviceStartedAt: dto.serviceStartedAt ? new Date(dto.serviceStartedAt) : null,
        policyHash: dto.policyHash ?? null,
        agentVersion: dto.agentVersion,
        applicationVersion: dto.applicationVersion,
        outboxDepth: dto.outboxDepth,
      },
      update: {
        clientTime: clientTimeDate,
        serverTime: now,
        serviceRunning: dto.serviceRunning,
        watcherActive: dto.watcherActive,
        serviceStartedAt: dto.serviceStartedAt ? new Date(dto.serviceStartedAt) : null,
        policyHash: dto.policyHash ?? null,
        agentVersion: dto.agentVersion,
        applicationVersion: dto.applicationVersion,
        outboxDepth: dto.outboxDepth,
      },
    });

    // 2. Cold history: Append ServiceStatusEvent if state changed or >= 15 min passed
    const lastEvent = await this.prisma.serviceStatusEvent.findFirst({
      where: { installationId: installation.id },
      orderBy: { recordedAt: 'desc' },
    });

    const hasStateChange =
      !lastEvent ||
      lastEvent.serviceRunning !== dto.serviceRunning ||
      lastEvent.watcherActive !== dto.watcherActive;

    const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60 * 1000);
    const isOverdue = !lastEvent || lastEvent.recordedAt <= fifteenMinutesAgo;

    if (hasStateChange || isOverdue) {
      await this.prisma.serviceStatusEvent.create({
        data: {
          installationId: installation.id,
          companyId: installation.companyId,
          serviceRunning: dto.serviceRunning,
          watcherActive: dto.watcherActive,
          recordedAt: now,
        },
      });
    }

    // 3. Audit logging (no per-ping spam: only first enrollment or service state change)
    if (!priorState) {
      await this.audit.logEvent({
        companyId: installation.companyId,
        actorId: installation.id,
        actorType: 'AGENT',
        action: 'TELEMETRY_FIRST_PING',
        targetType: 'Installation',
        targetId: installation.id,
        result: 'SUCCESS',
        reason: 'First telemetry ping received from installation',
      });
    } else if (priorState.serviceRunning !== dto.serviceRunning) {
      await this.audit.logEvent({
        companyId: installation.companyId,
        actorId: installation.id,
        actorType: 'AGENT',
        action: dto.serviceRunning ? 'SERVICE_STARTED' : 'SERVICE_STOPPED',
        targetType: 'Installation',
        targetId: installation.id,
        result: 'SUCCESS',
        reason: `Service running status transitioned to ${dto.serviceRunning}`,
      });
    }

    // 4. Command retrieval: pending commands + unacknowledged delivered commands needing redelivery
    const redeliveryCutoff = new Date(now.getTime() - COMMAND_REDELIVERY_TIMEOUT_SECONDS * 1000);

    const pendingCommands = await this.prisma.agentCommand.findMany({
      where: {
        installationId: installation.id,
        expiresAt: { gt: now },
        OR: [
          { status: 'PENDING' },
          {
            status: 'DELIVERED',
            deliveredAt: { lte: redeliveryCutoff },
          },
        ],
      },
      orderBy: { issuedAt: 'asc' },
    });

    // Mark retrieved commands as DELIVERED
    if (pendingCommands.length > 0) {
      await this.prisma.agentCommand.updateMany({
        where: {
          id: { in: pendingCommands.map((c) => c.id) },
        },
        data: {
          status: 'DELIVERED',
          deliveredAt: now,
        },
      });
    }

    const commandDtos: TelemetryCommandResponseDto[] = pendingCommands.map((cmd) => ({
      id: cmd.id,
      type: cmd.commandType,
      issuedAt: cmd.issuedAt.toISOString(),
      expiresAt: cmd.expiresAt.toISOString(),
    }));

    // Fetch company configuration
    const company = await this.prisma.company.findUnique({
      where: { id: installation.companyId },
      select: { telemetryEnabled: true, syncFullPaths: true },
    });

    return {
      serverTime: now.toISOString(),
      installationStatus: installation.status,
      telemetry: {
        enabled: company?.telemetryEnabled ?? true,
        intervalSeconds: TELEMETRY_PING_DEFAULT_INTERVAL_SECONDS,
        syncFullPaths: company?.syncFullPaths ?? false,
      },
      commands: commandDtos,
    };
  }

  /**
   * Ingests a scan summary from an agent.
   * - Accepts only from ACTIVE installations.
   * - Idempotent upsert on (installationId, clientScanId).
   */
  async recordScanSummary(
    installation: InstallationWithCompany,
    dto: ScanSummaryDto,
  ): Promise<{ success: boolean; scanRunId: string }> {
    if (installation.status !== 'ACTIVE') {
      throw new ForbiddenException('Scan summaries accepted only from ACTIVE installations');
    }

    if (!this.checkRateLimit(this.summaryRateLimits, `${installation.id}:scan`, 10, 60_000)) {
      this.logger.warn(`Rate limit exceeded for scan summary from ${installation.id}`);
    }

    const startedAt = new Date(dto.startedAt);
    const completedAt = dto.completedAt ? new Date(dto.completedAt) : null;

    // Idempotent upsert of ScanRun
    const scanRun = await this.prisma.scanRun.upsert({
      where: {
        installationId_clientScanId: {
          installationId: installation.id,
          clientScanId: dto.clientScanId,
        },
      },
      create: {
        installationId: installation.id,
        companyId: installation.companyId,
        clientScanId: dto.clientScanId,
        scanSource: dto.scanSource,
        targetSummary: dto.targetSummary ?? null,
        status: dto.status,
        startedAt,
        completedAt,
        durationSeconds: dto.durationSeconds,
        filesScanned: dto.filesScanned,
        filesWithPii: dto.filesWithPii,
        totalFindings: dto.totalFindings,
        highestTier: dto.highestTier ?? null,
        tierCounts: dto.tierCounts ?? {},
        entityTypeTotals: dto.entityTypeTotals ?? {},
        filesTruncated: dto.filesTruncated,
      },
      update: {
        status: dto.status,
        completedAt,
        durationSeconds: dto.durationSeconds,
        filesScanned: dto.filesScanned,
        filesWithPii: dto.filesWithPii,
        totalFindings: dto.totalFindings,
        highestTier: dto.highestTier ?? null,
        tierCounts: dto.tierCounts ?? {},
        entityTypeTotals: dto.entityTypeTotals ?? {},
        filesTruncated: dto.filesTruncated,
      },
    });

    // Ingest capped per-file findings if present
    if (dto.files && dto.files.length > 0) {
      // Clean previous findings if replayed
      await this.prisma.scanFindingSummary.deleteMany({
        where: { scanRunId: scanRun.id },
      });

      await this.prisma.scanFindingSummary.createMany({
        data: dto.files.map((f) => ({
          scanRunId: scanRun.id,
          installationId: installation.id,
          pathRef: f.pathRef,
          tier: f.tier,
          entityTypeCounts: f.entityTypeCounts,
          watermarkStatus: f.watermarkStatus ?? null,
        })),
      });
    }

    // Update lastScanAt on hot state
    await this.prisma.installationTelemetryState.updateMany({
      where: { installationId: installation.id },
      data: { lastScanAt: completedAt ?? startedAt },
    });

    return { success: true, scanRunId: scanRun.id };
  }

  /**
   * Ingests 15-minute enforcement aggregation windows from an agent.
   * - Accepts only from ACTIVE installations.
   * - Idempotent upsert on (installationId, windowStart, source).
   */
  async recordEnforcementSummary(
    installation: InstallationWithCompany,
    dto: EnforcementSummaryDto,
  ): Promise<{ success: boolean; count: number }> {
    if (installation.status !== 'ACTIVE') {
      throw new ForbiddenException('Enforcement summaries accepted only from ACTIVE installations');
    }

    if (!dto.windows || dto.windows.length === 0) {
      return { success: true, count: 0 };
    }

    let latestWindow: Date | null = null;

    for (const w of dto.windows) {
      const windowStart = new Date(w.windowStart);
      const windowEnd = new Date(w.windowEnd);

      if (!latestWindow || windowEnd > latestWindow) {
        latestWindow = windowEnd;
      }

      await this.prisma.enforcementWindow.upsert({
        where: {
          installationId_windowStart_source: {
            installationId: installation.id,
            windowStart,
            source: w.source,
          },
        },
        create: {
          installationId: installation.id,
          companyId: installation.companyId,
          windowStart,
          windowEnd,
          source: w.source,
          actionCounts: w.actionCounts,
          tierCounts: w.tierCounts,
          overrideCount: w.overrideCount,
        },
        update: {
          windowEnd,
          actionCounts: w.actionCounts,
          tierCounts: w.tierCounts,
          overrideCount: w.overrideCount,
        },
      });
    }

    if (latestWindow) {
      await this.prisma.installationTelemetryState.updateMany({
        where: { installationId: installation.id },
        data: { lastEnforcementAt: latestWindow },
      });
    }

    return { success: true, count: dto.windows.length };
  }

  /**
   * Ingests a command acknowledgment from an agent.
   */
  async recordCommandAck(
    installation: InstallationWithCompany,
    dto: CommandAckDto,
  ): Promise<{ success: boolean }> {
    const command = await this.prisma.agentCommand.findFirst({
      where: {
        id: dto.commandId,
        installationId: installation.id,
      },
    });

    if (!command) {
      throw new NotFoundException(`Command ${dto.commandId} not found for this installation`);
    }

    await this.prisma.agentCommand.update({
      where: { id: dto.commandId },
      data: {
        status: 'ACKNOWLEDGED',
        acknowledgedAt: new Date(),
        result: dto.result,
        resultDetail: dto.detail ?? null,
      },
    });

    await this.audit.logEvent({
      companyId: installation.companyId,
      actorId: installation.id,
      actorType: 'AGENT',
      action: 'AGENT_COMMAND_ACKNOWLEDGED',
      targetType: 'AgentCommand',
      targetId: dto.commandId,
      result: dto.result === 'success' ? 'SUCCESS' : 'FAILURE',
      reason: `Result: ${dto.result}${dto.detail ? ` (${dto.detail.slice(0, 100)})` : ''}`,
    });

    return { success: true };
  }

  // ─── Admin Endpoints (Tenant Scoped) ────────────────────────────────────────

  /**
   * Returns live state, derived status, recent scans, enforcement, and commands.
   */
  async getInstallationTelemetry(installationId: string, allowedCompanyIds: string[]) {
    const installation = await this.prisma.installation.findFirst({
      where: {
        id: installationId,
        ...(allowedCompanyIds.includes('*') ? {} : { companyId: { in: allowedCompanyIds } }),
      },
      include: {
        company: {
          select: {
            id: true,
            name: true,
            telemetryEnabled: true,
            syncFullPaths: true,
          },
        },
        telemetryState: true,
      },
    });

    if (!installation) {
      throw new NotFoundException('Installation not found');
    }

    const derivedStatus = deriveTelemetryStatus({
      telemetryEnabled: installation.company.telemetryEnabled,
      serverTime: installation.telemetryState?.serverTime ?? null,
      serviceRunning: installation.telemetryState?.serviceRunning ?? false,
      intervalSeconds: TELEMETRY_PING_DEFAULT_INTERVAL_SECONDS,
    });

    // Last 20 scans
    const recentScans = await this.prisma.scanRun.findMany({
      where: { installationId },
      orderBy: { startedAt: 'desc' },
      take: 20,
    });

    // Enforcement windows (last 7 days)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const enforcementWindows = await this.prisma.enforcementWindow.findMany({
      where: {
        installationId,
        windowStart: { gte: sevenDaysAgo },
      },
      orderBy: { windowStart: 'desc' },
    });

    // Last 10 commands
    const recentCommands = await this.prisma.agentCommand.findMany({
      where: { installationId },
      orderBy: { issuedAt: 'desc' },
      take: 10,
      include: {
        issuedByUser: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    return {
      installation: {
        id: installation.id,
        companyId: installation.companyId,
        companyName: installation.company.name,
        deviceId: installation.deviceId,
        hostname: installation.hostname,
        employeeName: installation.employeeName,
        employeeEmail: installation.employeeEmail,
        status: installation.status,
        lastHeartbeatAt: installation.lastHeartbeatAt,
      },
      telemetryConfig: {
        telemetryEnabled: installation.company.telemetryEnabled,
        syncFullPaths: installation.company.syncFullPaths,
      },
      telemetryState: installation.telemetryState,
      derivedStatus,
      recentScans,
      enforcementWindows,
      recentCommands,
    };
  }

  /**
   * Returns scan detail including capped per-file rows.
   */
  async getScanDetail(
    installationId: string,
    scanRunId: string,
    allowedCompanyIds: string[],
  ) {
    const scanRun = await this.prisma.scanRun.findFirst({
      where: {
        id: scanRunId,
        installationId,
        ...(allowedCompanyIds.includes('*') ? {} : { companyId: { in: allowedCompanyIds } }),
      },
      include: {
        findings: {
          orderBy: { createdAt: 'asc' },
          take: 200,
        },
      },
    });

    if (!scanRun) {
      throw new NotFoundException('Scan run not found');
    }

    return scanRun;
  }

  /**
   * Returns fleet-level telemetry KPIs.
   */
  async getTelemetrySummary(allowedCompanyIds: string[], days = 7) {
    const companyFilter = allowedCompanyIds.includes('*')
      ? {}
      : { companyId: { in: allowedCompanyIds } };

    const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Get all installations with their telemetry state and company config
    const installations = await this.prisma.installation.findMany({
      where: companyFilter,
      select: {
        id: true,
        status: true,
        telemetryState: true,
        company: {
          select: {
            telemetryEnabled: true,
          },
        },
      },
    });

    const statusCounts: Record<TelemetryStatus, number> = {
      LIVE: 0,
      STOPPED: 0,
      STALE: 0,
      OFFLINE: 0,
      NO_DATA: 0,
      DISABLED: 0,
    };

    for (const inst of installations) {
      const st = deriveTelemetryStatus({
        telemetryEnabled: inst.company.telemetryEnabled,
        serverTime: inst.telemetryState?.serverTime ?? null,
        serviceRunning: inst.telemetryState?.serviceRunning ?? false,
      });
      statusCounts[st] = (statusCounts[st] || 0) + 1;
    }

    // Scans in period
    const scansInPeriod = await this.prisma.scanRun.findMany({
      where: {
        ...companyFilter,
        startedAt: { gte: sinceDate },
      },
      select: {
        filesScanned: true,
        filesWithPii: true,
        totalFindings: true,
        tierCounts: true,
        entityTypeTotals: true,
      },
    });

    let totalFilesScanned = 0;
    let totalFilesWithPii = 0;
    let totalFindings = 0;
    const findingsByTier: Record<string, number> = {};
    const entityTypeTotals: Record<string, number> = {};

    for (const s of scansInPeriod) {
      totalFilesScanned += s.filesScanned;
      totalFilesWithPii += s.filesWithPii;
      totalFindings += s.totalFindings;

      if (s.tierCounts && typeof s.tierCounts === 'object') {
        for (const [tier, count] of Object.entries(s.tierCounts as Record<string, number>)) {
          findingsByTier[tier] = (findingsByTier[tier] || 0) + (count || 0);
        }
      }

      if (s.entityTypeTotals && typeof s.entityTypeTotals === 'object') {
        for (const [etype, count] of Object.entries(s.entityTypeTotals as Record<string, number>)) {
          entityTypeTotals[etype] = (entityTypeTotals[etype] || 0) + (count || 0);
        }
      }
    }

    // Enforcement actions in period
    const enforcementInPeriod = await this.prisma.enforcementWindow.findMany({
      where: {
        ...companyFilter,
        windowStart: { gte: sinceDate },
      },
      select: {
        actionCounts: true,
        overrideCount: true,
      },
    });

    const enforcementByAction: Record<string, number> = {
      block: 0,
      quarantine: 0,
      override: 0,
      warn: 0,
      allow: 0,
    };

    for (const w of enforcementInPeriod) {
      if (w.actionCounts && typeof w.actionCounts === 'object') {
        for (const [action, count] of Object.entries(w.actionCounts as Record<string, number>)) {
          enforcementByAction[action] = (enforcementByAction[action] || 0) + (count || 0);
        }
      }
      enforcementByAction.override += w.overrideCount || 0;
    }

    return {
      statusCounts,
      totalProtectedDevices: statusCounts.LIVE + statusCounts.STALE + statusCounts.STOPPED,
      totalInstallations: installations.length,
      filesScanned: totalFilesScanned,
      filesWithPii: totalFilesWithPii,
      totalFindings,
      findingsByTier,
      enforcementByAction,
      topEntityTypes: Object.entries(entityTypeTotals)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([name, count]) => ({ name, count })),
    };
  }

  /**
   * Returns paginated fleet table installations with derived telemetry status and last scan info.
   */
  async getFleetInstallations(
    allowedCompanyIds: string[],
    query: {
      companyId?: string;
      status?: string;
      tier?: string;
      search?: string;
      page?: number;
      pageSize?: number;
    },
  ) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20));

    const where: any = {};
    if (!allowedCompanyIds.includes('*')) {
      where.companyId = { in: allowedCompanyIds };
    }
    if (query.companyId && (allowedCompanyIds.includes('*') || allowedCompanyIds.includes(query.companyId))) {
      where.companyId = query.companyId;
    }

    if (query.search) {
      const s = query.search.trim();
      where.OR = [
        { hostname: { contains: s, mode: 'insensitive' } },
        { employeeName: { contains: s, mode: 'insensitive' } },
        { employeeEmail: { contains: s, mode: 'insensitive' } },
        { deviceId: { contains: s, mode: 'insensitive' } },
      ];
    }

    const installations = await this.prisma.installation.findMany({
      where,
      include: {
        company: {
          select: { id: true, name: true, telemetryEnabled: true },
        },
        telemetryState: true,
        scanRuns: {
          orderBy: { startedAt: 'desc' },
          take: 1,
        },
      },
    });

    // Derive status for all and filter in memory if status filter requested
    let mapped = installations.map((inst) => {
      const derivedStatus = deriveTelemetryStatus({
        telemetryEnabled: inst.company.telemetryEnabled,
        serverTime: inst.telemetryState?.serverTime ?? null,
        serviceRunning: inst.telemetryState?.serviceRunning ?? false,
      });

      const lastScan = inst.scanRuns[0] ?? null;

      return {
        id: inst.id,
        companyId: inst.companyId,
        companyName: inst.company.name,
        deviceId: inst.deviceId,
        hostname: inst.hostname,
        employeeName: inst.employeeName,
        employeeEmail: inst.employeeEmail,
        licenseStatus: inst.status,
        derivedStatus,
        agentVersion: inst.telemetryState?.agentVersion ?? inst.agentVersion,
        applicationVersion: inst.telemetryState?.applicationVersion ?? inst.applicationVersion,
        lastPingAt: inst.telemetryState?.serverTime ?? null,
        lastScan: lastScan
          ? {
              id: lastScan.id,
              status: lastScan.status,
              startedAt: lastScan.startedAt,
              completedAt: lastScan.completedAt,
              highestTier: lastScan.highestTier,
              totalFindings: lastScan.totalFindings,
              tierCounts: lastScan.tierCounts,
            }
          : null,
      };
    });

    if (query.status) {
      mapped = mapped.filter((item) => item.derivedStatus === query.status);
    }

    if (query.tier) {
      mapped = mapped.filter((item) => {
        const counts = item.lastScan?.tierCounts as Record<string, number> | undefined;
        return counts && (counts[query.tier!] ?? 0) > 0;
      });
    }

    const total = mapped.length;
    const paginated = mapped.slice((page - 1) * pageSize, page * pageSize);

    return {
      data: paginated,
      meta: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  /**
   * Issues a command to an installation.
   */
  async issueCommand(
    installationId: string,
    commandType: AllowedCommandType,
    actorUserId: string,
    allowedCompanyIds: string[],
  ) {
    if (!ALLOWED_COMMAND_TYPES.includes(commandType)) {
      throw new BadRequestException(`Invalid command type: ${commandType}`);
    }

    const installation = await this.prisma.installation.findFirst({
      where: {
        id: installationId,
        ...(allowedCompanyIds.includes('*') ? {} : { companyId: { in: allowedCompanyIds } }),
      },
    });

    if (!installation) {
      throw new NotFoundException('Installation not found');
    }

    const now = new Date();
    // Max one open command per (installationId, commandType)
    const existingOpen = await this.prisma.agentCommand.findFirst({
      where: {
        installationId,
        commandType,
        status: { in: ['PENDING', 'DELIVERED'] },
        expiresAt: { gt: now },
      },
    });

    if (existingOpen) {
      return existingOpen;
    }

    const expiresAt = new Date(now.getTime() + COMMAND_EXPIRY_DEFAULT_SECONDS * 1000);

    const command = await this.prisma.agentCommand.create({
      data: {
        installationId,
        companyId: installation.companyId,
        commandType,
        issuedByUserId: actorUserId,
        status: 'PENDING',
        expiresAt,
      },
    });

    await this.audit.logEvent({
      companyId: installation.companyId,
      actorId: actorUserId,
      actorType: 'USER',
      action: 'AGENT_COMMAND_ISSUED',
      targetType: 'AgentCommand',
      targetId: command.id,
      result: 'SUCCESS',
      reason: `Issued ${commandType} to installation ${installationId}`,
    });

    return command;
  }

  /**
   * Cancels a pending or delivered command.
   */
  async cancelCommand(
    installationId: string,
    commandId: string,
    actorUserId: string,
    allowedCompanyIds: string[],
  ) {
    const command = await this.prisma.agentCommand.findFirst({
      where: {
        id: commandId,
        installationId,
        ...(allowedCompanyIds.includes('*') ? {} : { companyId: { in: allowedCompanyIds } }),
      },
    });

    if (!command) {
      throw new NotFoundException('Command not found');
    }

    if (command.status === 'ACKNOWLEDGED') {
      throw new BadRequestException('Cannot cancel an already acknowledged command');
    }

    const updated = await this.prisma.agentCommand.update({
      where: { id: commandId },
      data: { status: 'CANCELLED' },
    });

    await this.audit.logEvent({
      companyId: command.companyId,
      actorId: actorUserId,
      actorType: 'USER',
      action: 'AGENT_COMMAND_CANCELLED',
      targetType: 'AgentCommand',
      targetId: command.id,
      result: 'SUCCESS',
      reason: `Cancelled ${command.commandType} on installation ${installationId}`,
    });

    return updated;
  }

  /**
   * Vendor cross-company fleet health rollup.
   * STRICT PRIVACY INVARIANT: Zero findings, zero file names, zero entity types.
   */
  async getVendorFleetHealth() {
    const installations = await this.prisma.installation.findMany({
      select: {
        id: true,
        companyId: true,
        agentVersion: true,
        telemetryState: {
          select: {
            serverTime: true,
            serviceRunning: true,
            agentVersion: true,
          },
        },
        company: {
          select: {
            id: true,
            name: true,
            telemetryEnabled: true,
          },
        },
      },
    });

    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const statusCounts: Record<TelemetryStatus, number> = {
      LIVE: 0,
      STALE: 0,
      STOPPED: 0,
      OFFLINE: 0,
      NO_DATA: 0,
      DISABLED: 0,
    };

    const agentVersionDistribution: Record<string, number> = {};
    let unseenOver7Days = 0;

    const companyMap = new Map<string, { companyId: string; companyName: string; totalInstallations: number; liveCount: number; staleOrOfflineCount: number }>();

    for (const inst of installations) {
      const tState = inst.telemetryState;
      const status = deriveTelemetryStatus({
        serverTime: tState?.serverTime ?? null,
        serviceRunning: tState?.serviceRunning ?? false,
        telemetryEnabled: inst.company?.telemetryEnabled ?? true,
        intervalSeconds: TELEMETRY_PING_DEFAULT_INTERVAL_SECONDS,
        now,
      });

      statusCounts[status] = (statusCounts[status] || 0) + 1;

      const ver = tState?.agentVersion || inst.agentVersion || 'unknown';
      agentVersionDistribution[ver] = (agentVersionDistribution[ver] || 0) + 1;

      if (!tState?.serverTime || new Date(tState.serverTime) < sevenDaysAgo) {
        unseenOver7Days++;
      }

      const compId = inst.companyId;
      const compName = inst.company?.name || compId;
      if (!companyMap.has(compId)) {
        companyMap.set(compId, {
          companyId: compId,
          companyName: compName,
          totalInstallations: 0,
          liveCount: 0,
          staleOrOfflineCount: 0,
        });
      }
      const entry = companyMap.get(compId)!;
      entry.totalInstallations++;
      if (status === 'LIVE') entry.liveCount++;
      if (status === 'STALE' || status === 'OFFLINE') entry.staleOrOfflineCount++;
    }

    return {
      totalInstallations: installations.length,
      statusCounts,
      agentVersionDistribution,
      unseenOver7Days,
      companyRollups: Array.from(companyMap.values()),
    };
  }

  // ─── Retention Job ──────────────────────────────────────────────────────────

  /**
   * Prunes history older than retention policies and expires stale commands.
   * Runs daily.
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async runRetentionCleanup() {
    this.logger.log('Running telemetry retention cleanup...');
    const now = new Date();

    // 1. Prune ServiceStatusEvent older than 30 days
    const statusRetentionDate = new Date(now.getTime() - RETENTION_SERVICE_STATUS_DAYS * 24 * 60 * 60 * 1000);
    const deletedStatus = await this.prisma.serviceStatusEvent.deleteMany({
      where: { recordedAt: { lt: statusRetentionDate } },
    });

    // 2. Prune EnforcementWindow older than 180 days
    const enforcementRetentionDate = new Date(now.getTime() - RETENTION_ENFORCEMENT_DAYS * 24 * 60 * 60 * 1000);
    const deletedEnforcement = await this.prisma.enforcementWindow.deleteMany({
      where: { windowStart: { lt: enforcementRetentionDate } },
    });

    // 3. Mark expired commands
    const expiredCommands = await this.prisma.agentCommand.updateMany({
      where: {
        status: { in: ['PENDING', 'DELIVERED'] },
        expiresAt: { lt: now },
      },
      data: { status: 'EXPIRED' },
    });

    this.logger.log(
      `Retention cleanup finished: deleted ${deletedStatus.count} status events, ${deletedEnforcement.count} enforcement windows, expired ${expiredCommands.count} commands.`,
    );
  }
}
