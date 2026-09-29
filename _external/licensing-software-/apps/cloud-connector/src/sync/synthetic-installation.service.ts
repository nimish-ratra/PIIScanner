import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Installation } from '@prisma/client';

@Injectable()
export class SyntheticInstallationService {
  private readonly logger = new Logger(SyntheticInstallationService.name);
  private readonly connectorVersion = '1.1.0';

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Ensure a synthetic Installation row exists for this company (§1.1).
   * Key attributes:
   *   deviceId: "o365-connector-<companyId>"
   *   hostname: "cloud-connector"
   *   os: "cloud"
   *   applicationVersion: "1.1.0"
   */
  async ensureSyntheticInstallation(companyId: string): Promise<Installation> {
    const deviceId = `o365-connector-${companyId}`;

    // 1. Check if already exists
    let installation = await this.prisma.installation.findFirst({
      where: {
        companyId,
        deviceId,
      },
    });

    if (installation) {
      // Touch heartbeat
      return this.prisma.installation.update({
        where: { id: installation.id },
        data: {
          lastHeartbeatAt: new Date(),
          applicationVersion: this.connectorVersion,
          status: 'ACTIVE',
        },
      });
    }

    // 2. Find an active license allocation for this company
    const allocation = await this.prisma.licenseAllocation.findFirst({
      where: {
        companyId,
        status: 'ACTIVE',
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!allocation) {
      this.logger.warn(`No active LicenseAllocation found for company ${companyId}. Searching any allocation...`);
    }

    const fallbackAllocation = allocation || (await this.prisma.licenseAllocation.findFirst({
      where: { companyId },
    }));

    if (!fallbackAllocation) {
      throw new Error(`Cannot create synthetic installation: Company ${companyId} has no license allocations`);
    }

    // 3. Create synthetic Installation row
    installation = await this.prisma.installation.create({
      data: {
        companyId,
        allocationId: fallbackAllocation.id,
        deviceId,
        hostname: 'cloud-connector',
        os: 'cloud',
        osVersion: 'M365 Cloud Graph',
        applicationVersion: this.connectorVersion,
        agentVersion: this.connectorVersion,
        status: 'ACTIVE',
        lastHeartbeatAt: new Date(),
      },
    });

    // 4. Create initial telemetry state
    await this.prisma.installationTelemetryState.upsert({
      where: { installationId: installation.id },
      create: {
        installationId: installation.id,
        companyId,
        serviceRunning: true,
        watcherActive: true,
        applicationVersion: this.connectorVersion,
        agentVersion: this.connectorVersion,
        serverTime: new Date(),
      },
      update: {
        serviceRunning: true,
        watcherActive: true,
        serverTime: new Date(),
      },
    });

    this.logger.log(`Provisioned synthetic O365 Installation [${installation.id}] for company ${companyId}`);
    return installation;
  }
}
