import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { GraphService } from '../graph/graph.service.js';
import { AzureADCredentials } from '../auth/msal-auth.service.js';

export interface QuarantineRequest {
  companyId: string;
  installationId: string;
  driveId: string;
  itemId: string;
  itemName: string;
  tier: string;
  dryRunMode: boolean;
  quarantineLibraryName?: string;
  ownerEmail?: string;
}

@Injectable()
export class CloudQuarantineService {
  private readonly logger = new Logger(CloudQuarantineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly graphService: GraphService,
  ) {}

  /**
   * Execute cloud quarantine on a sensitive document (§1.5).
   * Strips sharing permissions, moves to restricted Quarantine folder (preserving version history),
   * and records an EnforcementWindow event against the synthetic Installation.
   */
  async quarantineItem(creds: AzureADCredentials, req: QuarantineRequest): Promise<{ status: string; details: string }> {
    const { companyId, installationId, driveId, itemId, itemName, tier, dryRunMode, quarantineLibraryName, ownerEmail } = req;
    const folderName = quarantineLibraryName || 'clAIssify-Quarantine';

    if (dryRunMode) {
      this.logger.log(`[DRY RUN] Would quarantine item '${itemName}' (Tier: ${tier}) in drive ${driveId}`);
      await this.recordEnforcementEvent(companyId, installationId, tier, 'quarantine_dry_run');
      return { status: 'DRY_RUN', details: `Dry-run: Flagged for quarantine (${tier})` };
    }

    try {
      this.logger.log(`Executing cloud quarantine for item '${itemName}' [${itemId}]`);

      // 1. Strip external/shared permissions
      const strippedPermissions = await this.graphService.stripSharingPermissions(creds, driveId, itemId);

      // 2. Move item into Quarantine library/folder (preserves full version history)
      const quarantineFolderId = await this.graphService.moveToQuarantineFolder(creds, driveId, itemId, folderName);

      // 3. Log EnforcementWindow event against the synthetic Installation (source: "o365_watcher")
      await this.recordEnforcementEvent(companyId, installationId, tier, 'quarantine');

      return {
        status: 'SUCCESS',
        details: `Item moved to ${folderName} (ID: ${quarantineFolderId}), stripped ${strippedPermissions.length} permissions.`,
      };
    } catch (err: any) {
      this.logger.error(`Failed to quarantine item '${itemName}': ${err.message}`);
      return { status: 'ERROR', details: err.message };
    }
  }

  private async recordEnforcementEvent(
    companyId: string,
    installationId: string,
    tier: string,
    action: string,
  ): Promise<void> {
    const now = new Date();
    // 15-minute window alignment
    const windowStart = new Date(Math.floor(now.getTime() / (15 * 60 * 1000)) * (15 * 60 * 1000));
    const windowEnd = new Date(windowStart.getTime() + 15 * 60 * 1000);

    const existingWindow = await this.prisma.enforcementWindow.findUnique({
      where: {
        installationId_windowStart_source: {
          installationId,
          windowStart,
          source: 'o365_watcher',
        },
      },
    });

    const actionCounts: Record<string, number> = existingWindow?.actionCounts ? (existingWindow.actionCounts as any) : {};
    const tierCounts: Record<string, number> = existingWindow?.tierCounts ? (existingWindow.tierCounts as any) : {};

    actionCounts[action] = (actionCounts[action] || 0) + 1;
    tierCounts[tier] = (tierCounts[tier] || 0) + 1;

    await this.prisma.enforcementWindow.upsert({
      where: {
        installationId_windowStart_source: {
          installationId,
          windowStart,
          source: 'o365_watcher',
        },
      },
      create: {
        companyId,
        installationId,
        windowStart,
        windowEnd,
        source: 'o365_watcher',
        actionCounts,
        tierCounts,
        overrideCount: 0,
      },
      update: {
        actionCounts,
        tierCounts,
      },
    });
  }
}
