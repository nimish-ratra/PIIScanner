-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "syncFullPaths" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "telemetryEnabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "InstallationTelemetryState" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "clientTime" TIMESTAMP(3),
    "serverTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "serviceRunning" BOOLEAN NOT NULL DEFAULT false,
    "watcherActive" BOOLEAN NOT NULL DEFAULT false,
    "serviceStartedAt" TIMESTAMP(3),
    "policyHash" TEXT,
    "agentVersion" TEXT,
    "applicationVersion" TEXT,
    "outboxDepth" INTEGER NOT NULL DEFAULT 0,
    "lastScanAt" TIMESTAMP(3),
    "lastEnforcementAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstallationTelemetryState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceStatusEvent" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "serviceRunning" BOOLEAN NOT NULL,
    "watcherActive" BOOLEAN NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceStatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanRun" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "clientScanId" TEXT NOT NULL,
    "scanSource" TEXT NOT NULL,
    "targetSummary" TEXT,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "durationSeconds" INTEGER NOT NULL DEFAULT 0,
    "filesScanned" INTEGER NOT NULL DEFAULT 0,
    "filesWithPii" INTEGER NOT NULL DEFAULT 0,
    "totalFindings" INTEGER NOT NULL DEFAULT 0,
    "highestTier" TEXT,
    "tierCounts" JSONB,
    "entityTypeTotals" JSONB,
    "filesTruncated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScanRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanFindingSummary" (
    "id" TEXT NOT NULL,
    "scanRunId" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "pathRef" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "entityTypeCounts" JSONB NOT NULL,
    "watermarkStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScanFindingSummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnforcementWindow" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "actionCounts" JSONB NOT NULL,
    "tierCounts" JSONB NOT NULL,
    "overrideCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnforcementWindow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentCommand" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "commandType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "issuedByUserId" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "deliveredAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "result" TEXT,
    "resultDetail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentCommand_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InstallationTelemetryState_installationId_key" ON "InstallationTelemetryState"("installationId");

-- CreateIndex
CREATE INDEX "InstallationTelemetryState_companyId_idx" ON "InstallationTelemetryState"("companyId");

-- CreateIndex
CREATE INDEX "InstallationTelemetryState_installationId_idx" ON "InstallationTelemetryState"("installationId");

-- CreateIndex
CREATE INDEX "ServiceStatusEvent_installationId_recordedAt_idx" ON "ServiceStatusEvent"("installationId", "recordedAt");

-- CreateIndex
CREATE INDEX "ServiceStatusEvent_companyId_recordedAt_idx" ON "ServiceStatusEvent"("companyId", "recordedAt");

-- CreateIndex
CREATE INDEX "ScanRun_companyId_startedAt_idx" ON "ScanRun"("companyId", "startedAt");

-- CreateIndex
CREATE INDEX "ScanRun_installationId_startedAt_idx" ON "ScanRun"("installationId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ScanRun_installationId_clientScanId_key" ON "ScanRun"("installationId", "clientScanId");

-- CreateIndex
CREATE INDEX "ScanFindingSummary_scanRunId_idx" ON "ScanFindingSummary"("scanRunId");

-- CreateIndex
CREATE INDEX "ScanFindingSummary_installationId_idx" ON "ScanFindingSummary"("installationId");

-- CreateIndex
CREATE INDEX "EnforcementWindow_companyId_windowStart_idx" ON "EnforcementWindow"("companyId", "windowStart");

-- CreateIndex
CREATE INDEX "EnforcementWindow_installationId_windowStart_idx" ON "EnforcementWindow"("installationId", "windowStart");

-- CreateIndex
CREATE UNIQUE INDEX "EnforcementWindow_installationId_windowStart_source_key" ON "EnforcementWindow"("installationId", "windowStart", "source");

-- CreateIndex
CREATE INDEX "AgentCommand_installationId_status_idx" ON "AgentCommand"("installationId", "status");

-- CreateIndex
CREATE INDEX "AgentCommand_companyId_status_idx" ON "AgentCommand"("companyId", "status");

-- AddForeignKey
ALTER TABLE "InstallationTelemetryState" ADD CONSTRAINT "InstallationTelemetryState_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "Installation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstallationTelemetryState" ADD CONSTRAINT "InstallationTelemetryState_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceStatusEvent" ADD CONSTRAINT "ServiceStatusEvent_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "Installation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceStatusEvent" ADD CONSTRAINT "ServiceStatusEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanRun" ADD CONSTRAINT "ScanRun_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "Installation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanRun" ADD CONSTRAINT "ScanRun_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanFindingSummary" ADD CONSTRAINT "ScanFindingSummary_scanRunId_fkey" FOREIGN KEY ("scanRunId") REFERENCES "ScanRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanFindingSummary" ADD CONSTRAINT "ScanFindingSummary_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "Installation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnforcementWindow" ADD CONSTRAINT "EnforcementWindow_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "Installation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnforcementWindow" ADD CONSTRAINT "EnforcementWindow_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentCommand" ADD CONSTRAINT "AgentCommand_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "Installation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentCommand" ADD CONSTRAINT "AgentCommand_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentCommand" ADD CONSTRAINT "AgentCommand_issuedByUserId_fkey" FOREIGN KEY ("issuedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
