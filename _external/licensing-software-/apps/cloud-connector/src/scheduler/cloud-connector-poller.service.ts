import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { CloudDeltaSyncService } from '../sync/cloud-delta-sync.service.js';

@Injectable()
export class CloudConnectorPollerService {
  private readonly logger = new Logger(CloudConnectorPollerService.name);
  private isPolling = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly deltaSyncService: CloudDeltaSyncService,
  ) {}

  /**
   * Periodic scheduler checking active companies every 60 seconds (§1.4).
   * Evaluates if company's pollIntervalMinutes has elapsed since lastSyncAt.
   */
  @Interval(60000)
  async handlePeriodicPolling() {
    if (this.isPolling) {
      this.logger.debug('Polling cycle already in progress, skipping iteration...');
      return;
    }

    this.isPolling = true;
    try {
      const activeConfigs = await this.prisma.cloudConnectorConfig.findMany({
        where: {
          enabled: true,
          adminConsentGranted: true,
        },
      });

      const now = Date.now();

      for (const config of activeConfigs) {
        const intervalMs = (config.pollIntervalMinutes || 5) * 60 * 1000;
        const lastSyncTime = config.lastSyncAt ? config.lastSyncAt.getTime() : 0;

        if (now - lastSyncTime >= intervalMs) {
          this.logger.log(`Triggering scheduled delta sync for company ${config.companyId} (Interval: ${config.pollIntervalMinutes}m)`);
          try {
            await this.deltaSyncService.syncCompany(config.companyId);
          } catch (companySyncErr: any) {
            this.logger.error(`Error during delta sync for company ${config.companyId}: ${companySyncErr.message}`);
          }
        }
      }
    } catch (err: any) {
      this.logger.error(`Poller scheduler error: ${err.message}`);
    } finally {
      this.isPolling = false;
    }
  }
}
