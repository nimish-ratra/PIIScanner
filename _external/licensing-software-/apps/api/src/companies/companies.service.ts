import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';

@Injectable()
export class CompaniesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll(allowedCompanyIds: string[]) {
    const where = allowedCompanyIds.includes('*') 
      ? {} 
      : { id: { in: allowedCompanyIds } };

    return this.prisma.company.findMany({
      where,
      select: {
        id: true,
        name: true,
        enterpriseId: true,
        allowedEmailDomains: true,
        telemetryEnabled: true,
        syncFullPaths: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async findOne(id: string, allowedCompanyIds: string[]) {
    if (!allowedCompanyIds.includes('*') && !allowedCompanyIds.includes(id)) {
      throw new NotFoundException('Company not found');
    }

    const company = await this.prisma.company.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        enterpriseId: true,
        allowedEmailDomains: true,
        telemetryEnabled: true,
        syncFullPaths: true,
        createdAt: true,
        updatedAt: true,
        enterprise: {
          select: {
            name: true,
          }
        }
      },
    });

    if (!company) {
      throw new NotFoundException('Company not found');
    }

    return company;
  }

  /**
   * Configures which employee-email domains this company accepts when
   * self-declared at agent registration time (see AgentService.register()).
   * An empty array means "no enforcement configured" — that's a deliberate,
   * valid state, not an error, so a company can be onboarded before anyone
   * gets around to setting this.
   */
  async setAllowedEmailDomains(id: string, allowedEmailDomains: unknown, allowedCompanyIds: string[], actorId: string) {
    if (!allowedCompanyIds.includes('*') && !allowedCompanyIds.includes(id)) {
      // 404, not 403 — same IDOR-avoidance convention used elsewhere in this codebase.
      throw new NotFoundException('Company not found');
    }
    if (!Array.isArray(allowedEmailDomains) || allowedEmailDomains.some((d) => typeof d !== 'string')) {
      throw new BadRequestException('allowedEmailDomains must be an array of strings');
    }

    const normalized = Array.from(
      new Set(
        allowedEmailDomains
          .map((d) => d.trim().toLowerCase())
          .filter((d) => d.length > 0),
      ),
    );

    const company = await this.prisma.company.update({
      where: { id },
      data: { allowedEmailDomains: normalized },
      select: { id: true, name: true, allowedEmailDomains: true },
    });

    await this.audit.logEvent({
      companyId: id,
      actorId,
      actorType: 'USER',
      action: 'UPDATE_COMPANY_EMAIL_DOMAINS',
      targetType: 'Company',
      targetId: id,
      result: 'SUCCESS',
      reason: `Set allowed email domains to [${normalized.join(', ')}]`,
    });

    return company;
  }

  /**
   * Updates company-level fleet telemetry settings (telemetryEnabled, syncFullPaths).
   */
  async updateTelemetrySettings(
    id: string,
    dto: { telemetryEnabled?: boolean; syncFullPaths?: boolean },
    allowedCompanyIds: string[],
    actorId: string,
  ) {
    if (!allowedCompanyIds.includes('*') && !allowedCompanyIds.includes(id)) {
      throw new NotFoundException('Company not found');
    }

    const data: { telemetryEnabled?: boolean; syncFullPaths?: boolean } = {};
    if (typeof dto.telemetryEnabled === 'boolean') {
      data.telemetryEnabled = dto.telemetryEnabled;
    }
    if (typeof dto.syncFullPaths === 'boolean') {
      data.syncFullPaths = dto.syncFullPaths;
    }

    const company = await this.prisma.company.update({
      where: { id },
      data,
      select: {
        id: true,
        name: true,
        allowedEmailDomains: true,
        telemetryEnabled: true,
        syncFullPaths: true,
      },
    });

    await this.audit.logEvent({
      companyId: id,
      actorId,
      actorType: 'USER',
      action: 'UPDATE_COMPANY_TELEMETRY_SETTINGS',
      targetType: 'Company',
      targetId: id,
      result: 'SUCCESS',
      reason: `Updated telemetry settings: telemetryEnabled=${company.telemetryEnabled}, syncFullPaths=${company.syncFullPaths}`,
    });

    return company;
  }

  async getCloudConnectorConfig(companyId: string, allowedCompanyIds: string[]) {
    if (!allowedCompanyIds.includes('*') && !allowedCompanyIds.includes(companyId)) {
      throw new NotFoundException('Company not found');
    }

    const config = await this.prisma.cloudConnectorConfig.findUnique({
      where: { companyId },
    });

    const syncStates = await this.prisma.cloudConnectorSyncState.findMany({
      where: { companyId },
      orderBy: { lastSyncAt: 'desc' },
    });

    return {
      configured: !!config,
      config: config
        ? {
            id: config.id,
            companyId: config.companyId,
            tenantId: config.tenantId,
            clientId: config.clientId,
            hasClientSecret: !!config.clientSecretEncrypted,
            clientSecretMasked: config.clientSecretEncrypted ? '••••••••••••••••' : null,
            certificateThumbprint: config.certificateThumbprint,
            adminConsentGranted: config.adminConsentGranted,
            enabled: config.enabled,
            pollIntervalMinutes: config.pollIntervalMinutes,
            dryRunMode: config.dryRunMode,
            quarantineLibraryName: config.quarantineLibraryName,
            lastSyncAt: config.lastSyncAt,
            status: config.status,
            statusMessage: config.statusMessage,
            createdAt: config.createdAt,
            updatedAt: config.updatedAt,
          }
        : null,
      syncStates,
    };
  }

  async updateCloudConnectorConfig(
    companyId: string,
    dto: any,
    allowedCompanyIds: string[],
    actorId: string,
  ) {
    if (!allowedCompanyIds.includes('*') && !allowedCompanyIds.includes(companyId)) {
      throw new NotFoundException('Company not found');
    }

    const { encryptSecret } = await import('./crypto.util.js');

    const updateData: any = {
      tenantId: dto.tenantId,
      clientId: dto.clientId,
      updatedAt: new Date(),
    };

    if (dto.clientSecret) {
      updateData.clientSecretEncrypted = encryptSecret(dto.clientSecret);
    }
    if (dto.certificateThumbprint !== undefined) {
      updateData.certificateThumbprint = dto.certificateThumbprint;
    }
    if (typeof dto.adminConsentGranted === 'boolean') {
      updateData.adminConsentGranted = dto.adminConsentGranted;
    }
    if (typeof dto.enabled === 'boolean') {
      updateData.enabled = dto.enabled;
    }
    if (typeof dto.pollIntervalMinutes === 'number') {
      updateData.pollIntervalMinutes = dto.pollIntervalMinutes;
    }
    if (typeof dto.dryRunMode === 'boolean') {
      updateData.dryRunMode = dto.dryRunMode;
    }
    if (dto.quarantineLibraryName) {
      updateData.quarantineLibraryName = dto.quarantineLibraryName;
    }

    const config = await this.prisma.cloudConnectorConfig.upsert({
      where: { companyId },
      create: {
        companyId,
        tenantId: dto.tenantId,
        clientId: dto.clientId,
        clientSecretEncrypted: dto.clientSecret ? encryptSecret(dto.clientSecret) : null,
        certificateThumbprint: dto.certificateThumbprint || null,
        adminConsentGranted: dto.adminConsentGranted ?? false,
        enabled: dto.enabled ?? true,
        pollIntervalMinutes: dto.pollIntervalMinutes ?? 5,
        dryRunMode: dto.dryRunMode ?? true,
        quarantineLibraryName: dto.quarantineLibraryName || 'clAIssify-Quarantine',
        status: dto.adminConsentGranted ? 'CONFIGURED' : 'PENDING_CONSENT',
      },
      update: updateData,
    });

    await this.audit.logEvent({
      companyId,
      actorId,
      actorType: 'USER',
      action: 'UPDATE_O365_CLOUD_CONNECTOR_CONFIG',
      targetType: 'Company',
      targetId: companyId,
      result: 'SUCCESS',
      reason: `Updated O365 Cloud Connector config: tenantId=${config.tenantId}, dryRunMode=${config.dryRunMode}`,
    });

    return {
      configured: true,
      config: {
        id: config.id,
        companyId: config.companyId,
        tenantId: config.tenantId,
        clientId: config.clientId,
        hasClientSecret: !!config.clientSecretEncrypted,
        clientSecretMasked: config.clientSecretEncrypted ? '••••••••••••••••' : null,
        certificateThumbprint: config.certificateThumbprint,
        adminConsentGranted: config.adminConsentGranted,
        enabled: config.enabled,
        pollIntervalMinutes: config.pollIntervalMinutes,
        dryRunMode: config.dryRunMode,
        quarantineLibraryName: config.quarantineLibraryName,
        lastSyncAt: config.lastSyncAt,
        status: config.status,
        statusMessage: config.statusMessage,
        createdAt: config.createdAt,
        updatedAt: config.updatedAt,
      },
    };
  }

  async triggerCloudConnectorSync(companyId: string, allowedCompanyIds: string[], actorId: string) {
    if (!allowedCompanyIds.includes('*') && !allowedCompanyIds.includes(companyId)) {
      throw new NotFoundException('Company not found');
    }

    // Try calling cloud-connector microservice
    const connectorPort = process.env.CLOUD_CONNECTOR_PORT || 3004;
    try {
      const res = await fetch(`http://127.0.0.1:${connectorPort}/sync/${companyId}`, {
        method: 'POST',
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const body = await res.json();
        await this.audit.logEvent({
          companyId,
          actorId,
          actorType: 'USER',
          action: 'TRIGGER_O365_CLOUD_CONNECTOR_SYNC',
          targetType: 'Company',
          targetId: companyId,
          result: 'SUCCESS',
          reason: 'Manual sync triggered successfully via cloud-connector service.',
        });
        return { status: 'triggered', result: body };
      }
    } catch (e: any) {
      // Connector service may be running in worker mode or offline
    }

    // Update status to indicate queued
    await this.prisma.cloudConnectorConfig.update({
      where: { companyId },
      data: {
        status: 'SYNCING',
        statusMessage: 'Manual sync queued by administrator.',
      },
    });

    await this.audit.logEvent({
      companyId,
      actorId,
      actorType: 'USER',
      action: 'TRIGGER_O365_CLOUD_CONNECTOR_SYNC',
      targetType: 'Company',
      targetId: companyId,
      result: 'SUCCESS',
      reason: 'Manual sync queued for next worker cycle.',
    });

    return { status: 'queued', message: 'Sync queued for execution.' };
  }
}
