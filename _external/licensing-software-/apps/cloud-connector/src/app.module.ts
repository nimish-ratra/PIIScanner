import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaService } from './prisma/prisma.service.js';
import { MsalAuthService } from './auth/msal-auth.service.js';
import { GraphService } from './graph/graph.service.js';
import { ClassificationClientService } from './classification/classification-client.service.js';
import { SyntheticInstallationService } from './sync/synthetic-installation.service.js';
import { CloudQuarantineService } from './remediation/cloud-quarantine.service.js';
import { CloudWatermarkService } from './remediation/cloud-watermark.service.js';
import { CloudDeltaSyncService } from './sync/cloud-delta-sync.service.js';
import { CloudConnectorPollerService } from './scheduler/cloud-connector-poller.service.js';
import { AppController } from './app.controller.js';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [AppController],
  providers: [
    PrismaService,
    MsalAuthService,
    GraphService,
    ClassificationClientService,
    SyntheticInstallationService,
    CloudQuarantineService,
    CloudWatermarkService,
    CloudDeltaSyncService,
    CloudConnectorPollerService,
  ],
  exports: [
    PrismaService,
    MsalAuthService,
    GraphService,
    CloudDeltaSyncService,
  ],
})
export class AppModule {}
