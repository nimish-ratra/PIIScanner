import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { GraphService, GraphDriveItem } from '../graph/graph.service.js';
import { SyntheticInstallationService } from './synthetic-installation.service.js';
import { ClassificationClientService, ClassificationResultDto } from '../classification/classification-client.service.js';
import { CloudQuarantineService } from '../remediation/cloud-quarantine.service.js';
import { CloudWatermarkService } from '../remediation/cloud-watermark.service.js';
import * as crypto from 'node:crypto';
import * as path from 'node:path';

const SCANNABLE_EXTENSIONS = new Set([
  '.pdf', '.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt',
  '.csv', '.txt', '.json', '.xml', '.rtf', '.odt', '.ods',
]);

@Injectable()
export class CloudDeltaSyncService {
  private readonly logger = new Logger(CloudDeltaSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly graphService: GraphService,
    private readonly syntheticInstallation: SyntheticInstallationService,
    private readonly classifier: ClassificationClientService,
    private readonly quarantineService: CloudQuarantineService,
    private readonly watermarkService: CloudWatermarkService,
  ) {}

  /**
   * Run delta sync across all SharePoint sites and OneDrive drives for a company (§1.3).
   */
  async syncCompany(companyId: string): Promise<{ sitesSynced: number; drivesSynced: number; filesProcessed: number }> {
    const config = await this.prisma.cloudConnectorConfig.findUnique({
      where: { companyId },
      include: { company: true },
    });

    if (!config || !config.enabled) {
      this.logger.debug(`Skipping sync for company ${companyId}: Not configured or disabled`);
      return { sitesSynced: 0, drivesSynced: 0, filesProcessed: 0 };
    }

    const creds = {
      tenantId: config.tenantId,
      clientId: config.clientId,
      clientSecretEncrypted: config.clientSecretEncrypted,
      certificateThumbprint: config.certificateThumbprint,
    };

    // 1. Ensure synthetic installation exists (§1.1)
    const installation = await this.syntheticInstallation.ensureSyntheticInstallation(companyId);

    let totalFilesProcessed = 0;
    let sitesSynced = 0;
    let drivesSynced = 0;

    // 2. Sync SharePoint Sites
    try {
      const sites = await this.graphService.enumerateSites(creds);
      this.logger.log(`Found ${sites.length} SharePoint site(s) for company ${companyId}`);

      for (const site of sites) {
        const driveId = await this.graphService.getSiteDefaultDriveId(creds, site.id);
        if (driveId) {
          const processed = await this.syncDriveResource(
            creds,
            companyId,
            installation.id,
            config.company.syncFullPaths,
            config.dryRunMode,
            config.quarantineLibraryName,
            'sharepoint_site',
            driveId,
            site.displayName || site.name,
            'o365_sharepoint',
            `SharePoint: ${site.displayName || site.name}`,
          );
          totalFilesProcessed += processed;
          sitesSynced++;
        }
      }
    } catch (siteErr: any) {
      this.logger.error(`SharePoint sync error for company ${companyId}: ${siteErr.message}`);
    }

    // 3. Sync OneDrive User Drives
    try {
      const userDrives = await this.graphService.enumerateUserDrives(creds);
      this.logger.log(`Found ${userDrives.length} OneDrive user drive(s) for company ${companyId}`);

      for (const ud of userDrives) {
        const processed = await this.syncDriveResource(
          creds,
          companyId,
          installation.id,
          config.company.syncFullPaths,
          config.dryRunMode,
          config.quarantineLibraryName,
          'onedrive_user',
          ud.driveId,
          ud.userPrincipalName,
          'o365_onedrive',
          `OneDrive: ${ud.userPrincipalName}`,
        );
        totalFilesProcessed += processed;
        drivesSynced++;
      }
    } catch (odErr: any) {
      this.logger.error(`OneDrive sync error for company ${companyId}: ${odErr.message}`);
    }

    // Update config lastSyncAt
    await this.prisma.cloudConnectorConfig.update({
      where: { companyId },
      data: {
        lastSyncAt: new Date(),
        status: 'CONFIGURED',
        statusMessage: `Sync completed: ${sitesSynced} site(s), ${drivesSynced} drive(s), ${totalFilesProcessed} file(s) evaluated.`,
      },
    });

    return { sitesSynced, drivesSynced, filesProcessed: totalFilesProcessed };
  }

  /**
   * Sync a single drive resource (SharePoint Document Library or OneDrive Root) via /delta (§1.3).
   */
  private async syncDriveResource(
    creds: any,
    companyId: string,
    installationId: string,
    syncFullPaths: boolean,
    dryRunMode: boolean,
    quarantineLibraryName: string,
    resourceType: string,
    driveId: string,
    resourceName: string,
    scanSource: 'o365_sharepoint' | 'o365_onedrive',
    targetSummary: string,
  ): Promise<number> {
    // 1. Fetch or initialize delta sync state
    let syncState = await this.prisma.cloudConnectorSyncState.findUnique({
      where: {
        companyId_resourceType_resourceId: {
          companyId,
          resourceType,
          resourceId: driveId,
        },
      },
    });

    const existingDeltaLink = syncState?.deltaLink;

    // 2. Query Graph delta
    const deltaRes = await this.graphService.getDriveDelta(creds, driveId, existingDeltaLink);
    const candidateFiles = (deltaRes.items || []).filter((item) => {
      if (item.folder || item.deleted) return false;
      const ext = path.extname(item.name || '').toLowerCase();
      return SCANNABLE_EXTENSIONS.has(ext);
    });

    if (candidateFiles.length === 0) {
      // Still persist updated deltaLink cursor
      await this.prisma.cloudConnectorSyncState.upsert({
        where: {
          companyId_resourceType_resourceId: {
            companyId,
            resourceType,
            resourceId: driveId,
          },
        },
        create: {
          companyId,
          resourceType,
          resourceId: driveId,
          resourceName,
          deltaLink: deltaRes.nextDeltaLink,
          lastSyncAt: new Date(),
          itemCount: 0,
          status: 'IDLE',
        },
        update: {
          deltaLink: deltaRes.nextDeltaLink,
          lastSyncAt: new Date(),
          status: 'IDLE',
        },
      });
      return 0;
    }

    this.logger.log(`Processing ${candidateFiles.length} delta file(s) for ${targetSummary}...`);

    // 3. Create ScanRun row linked to the synthetic installation (§1.1, §1.3)
    const clientScanId = `o365-${driveId.slice(0, 8)}-${Date.now()}`;
    const startedAt = new Date();

    const scanRun = await this.prisma.scanRun.create({
      data: {
        installationId,
        companyId,
        clientScanId,
        scanSource,
        targetSummary,
        status: 'completed',
        startedAt,
        filesScanned: candidateFiles.length,
      },
    });

    let filesWithPii = 0;
    let totalFindings = 0;
    const tierCounts: Record<string, number> = {};
    const entityTypeTotals: Record<string, number> = {};
    let highestTier = 'Public';
    const tierRanks: Record<string, number> = {
      'Public': 1,
      'General': 2,
      'Confidential': 3,
      'Highly Confidential': 4,
      'Restricted': 5,
    };

    // 4. Download and classify each file
    for (const item of candidateFiles) {
      try {
        const contentBuffer = await this.graphService.downloadItemContent(creds, driveId, item.id);
        const classification = await this.classifier.classifyStream(item.name, contentBuffer);

        if (classification.total_findings > 0) {
          filesWithPii++;
          totalFindings += classification.total_findings;

          // Track highest tier
          if ((tierRanks[classification.tier] || 0) > (tierRanks[highestTier] || 0)) {
            highestTier = classification.tier;
          }

          tierCounts[classification.tier] = (tierCounts[classification.tier] || 0) + 1;
          for (const [ent, cnt] of Object.entries(classification.entity_counts)) {
            entityTypeTotals[ent] = (entityTypeTotals[ent] || 0) + cnt;
          }

          // Path reference privacy rule (§1.1)
          const rawRef = item.webUrl || `${driveId}/${item.id}`;
          const pathRef = syncFullPaths
            ? rawRef
            : 'sha256:' + crypto.createHash('sha256').update(rawRef).digest('hex');

          // Save finding summary
          await this.prisma.scanFindingSummary.create({
            data: {
              scanRunId: scanRun.id,
              installationId,
              pathRef,
              tier: classification.tier,
              entityTypeCounts: classification.entity_counts,
              watermarkStatus: classification.tier === 'Restricted' || classification.tier === 'Highly Confidential' ? 'PENDING' : null,
            },
          });

          // 5. Remediation actions (§1.5 Quarantine, §1.6 Watermarking)
          if (classification.tier === 'Restricted') {
            await this.quarantineService.quarantineItem(creds, {
              companyId,
              installationId,
              driveId,
              itemId: item.id,
              itemName: item.name,
              tier: classification.tier,
              dryRunMode,
              quarantineLibraryName,
            });
          } else if (classification.tier === 'Highly Confidential' || classification.tier === 'Confidential') {
            await this.watermarkService.watermarkItem(creds, {
              companyId,
              installationId,
              driveId,
              itemId: item.id,
              itemName: item.name,
              tier: classification.tier,
              dryRunMode,
            });
          }
        }
      } catch (fileErr: any) {
        this.logger.error(`Error classifying '${item.name}': ${fileErr.message}`);
      }
    }

    // 6. Complete ScanRun row
    const completedAt = new Date();
    const durationSeconds = Math.max(1, Math.round((completedAt.getTime() - startedAt.getTime()) / 1000));

    await this.prisma.scanRun.update({
      where: { id: scanRun.id },
      data: {
        completedAt,
        durationSeconds,
        filesWithPii,
        totalFindings,
        highestTier,
        tierCounts,
        entityTypeTotals,
      },
    });

    // 7. Persist updated delta cursor in CloudConnectorSyncState
    await this.prisma.cloudConnectorSyncState.upsert({
      where: {
        companyId_resourceType_resourceId: {
          companyId,
          resourceType,
          resourceId: driveId,
        },
      },
      create: {
        companyId,
        resourceType,
        resourceId: driveId,
        resourceName,
        deltaLink: deltaRes.nextDeltaLink,
        lastSyncAt: new Date(),
        itemCount: candidateFiles.length,
        status: 'IDLE',
      },
      update: {
        deltaLink: deltaRes.nextDeltaLink,
        lastSyncAt: new Date(),
        itemCount: candidateFiles.length,
        status: 'IDLE',
      },
    });

    return candidateFiles.length;
  }
}
