'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { apiClient, ApiError } from '@/lib/api-client';
import {
  InstallationTelemetryData,
  ScanRun,
  AgentCommand,
  EnforcementWindow,
  ScanFindingSummary,
} from '@/lib/types';
import { TELEMETRY_STATUS_CONFIG } from './telemetry-status';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Cpu,
  FileCheck,
  FileText,
  HelpCircle,
  PlayCircle,
  RefreshCw,
  RotateCcw,
  Shield,
  ShieldAlert,
  Terminal,
  XCircle,
  Layers,
  ChevronRight,
  Eye,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

interface InstallationProtectionTabProps {
  installationId: string;
  canManage: boolean;
}

const fmtDateTime = (d?: string | null) => (d ? new Date(d).toLocaleString() : '—');

const TIER_BADGE_CLASSES: Record<string, string> = {
  Restricted: 'bg-purple-50 text-purple-700 ring-1 ring-purple-200',
  'Highly Confidential': 'bg-red-50 text-red-700 ring-1 ring-red-200',
  Confidential: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  General: 'bg-slate-50 text-slate-700 ring-1 ring-slate-200',
  Public: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
};

export function InstallationProtectionTab({ installationId, canManage }: InstallationProtectionTabProps) {
  const [data, setData] = useState<InstallationTelemetryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Command issuing state
  const [selectedCommand, setSelectedCommand] = useState<AgentCommand['commandType'] | null>(null);
  const [issuingCommand, setIssuingCommand] = useState(false);
  const [commandError, setCommandError] = useState<string | null>(null);

  // Diagnostics result modal
  const [viewingDetail, setViewingDetail] = useState<string | null>(null);

  // Scan detail modal
  const [selectedScanRun, setSelectedScanRun] = useState<ScanRun | null>(null);
  const [scanDetailLoading, setScanDetailLoading] = useState(false);

  const loadTelemetry = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await apiClient<InstallationTelemetryData>(
        `/customer/installations/${installationId}/telemetry`
      );
      setData(res);
      setError(null);
    } catch (err: any) {
      if (!silent) {
        setError(err instanceof ApiError ? err.message : 'Failed to load telemetry.');
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [installationId]);

  useEffect(() => {
    loadTelemetry();

    // 30s polling only while tab is visible
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        loadTelemetry(true);
      }
    }, 30000);

    return () => clearInterval(interval);
  }, [loadTelemetry]);

  const handleIssueCommand = async (type: AgentCommand['commandType']) => {
    setIssuingCommand(true);
    setCommandError(null);
    try {
      await apiClient(`/customer/installations/${installationId}/commands`, {
        method: 'POST',
        body: JSON.stringify({ commandType: type }),
      });
      setSelectedCommand(null);
      await loadTelemetry(true);
    } catch (err: any) {
      setCommandError(err instanceof ApiError ? err.message : 'Failed to issue command.');
    } finally {
      setIssuingCommand(false);
    }
  };

  const handleCancelCommand = async (commandId: string) => {
    try {
      await apiClient(`/customer/installations/${installationId}/commands/${commandId}`, {
        method: 'DELETE',
      });
      await loadTelemetry(true);
    } catch (err: any) {
      setError(err instanceof ApiError ? err.message : 'Failed to cancel command.');
    }
  };

  const handleViewScanDetail = async (scan: ScanRun) => {
    setSelectedScanRun(scan);
    setScanDetailLoading(true);
    try {
      const fullScan = await apiClient<ScanRun>(
        `/customer/installations/${installationId}/scans/${scan.id}`
      );
      setSelectedScanRun(fullScan);
    } catch (err: any) {
      // Keep basic scan run
    } finally {
      setScanDetailLoading(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="py-12 text-center text-zinc-500 text-sm flex flex-col items-center gap-2">
        <RefreshCw className="h-5 w-5 animate-spin text-zinc-400" />
        Loading protection and telemetry state...
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="p-4 bg-red-50 text-red-700 text-sm rounded-lg border border-red-200">
        {error}
      </div>
    );
  }

  const derivedStatus = data?.derivedStatus ?? 'NO_DATA';
  const statusCfg = TELEMETRY_STATUS_CONFIG[derivedStatus];
  const tState = data?.telemetryState;
  const scans = data?.scans ?? [];
  const commands = data?.commands ?? [];
  const enforcement = data?.enforcementWindows ?? [];

  // Prepare chart data (aggregate by day)
  const enforcementChartData = Object.values(
    enforcement.reduce<Record<string, { date: string; block: number; quarantine: number; override: number; warn: number; allow: number }>>(
      (acc, win) => {
        const d = new Date(win.windowStart).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        if (!acc[d]) {
          acc[d] = { date: d, block: 0, quarantine: 0, override: 0, warn: 0, allow: 0 };
        }
        acc[d].block += win.actionCounts?.block || 0;
        acc[d].quarantine += win.actionCounts?.quarantine || 0;
        acc[d].override += win.actionCounts?.override || 0;
        acc[d].warn += win.actionCounts?.warn || 0;
        acc[d].allow += win.actionCounts?.allow || 0;
        return acc;
      },
      {}
    )
  ).slice(-7);

  return (
    <div className="space-y-6 pt-2 pb-6">
      {/* Live Status Header */}
      <div className="bg-zinc-50/70 border border-zinc-200/80 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className={`h-3 w-3 rounded-full ${statusCfg.dotClass}`} />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-zinc-900">Fleet Protection</span>
              <Badge variant="outline" className={statusCfg.classes}>
                {statusCfg.label}
              </Badge>
            </div>
            <p className="text-xs text-zinc-500 mt-0.5">{statusCfg.description}</p>
          </div>
        </div>

        <div className="flex items-center gap-6 text-xs text-zinc-600">
          <div>
            <span className="text-zinc-400 block text-[10px] uppercase tracking-wider">Last Ping</span>
            <span className="font-medium text-zinc-800">{fmtDateTime(tState?.lastPingAt)}</span>
          </div>
          <div>
            <span className="text-zinc-400 block text-[10px] uppercase tracking-wider">Service State</span>
            <span className="font-medium text-zinc-800">
              {tState ? (tState.serviceRunning ? 'Running' : 'Stopped') : '—'}
            </span>
          </div>
          <div>
            <span className="text-zinc-400 block text-[10px] uppercase tracking-wider">File Watcher</span>
            <span className="font-medium text-zinc-800">
              {tState ? (tState.watcherActive ? 'Active' : 'Inactive') : '—'}
            </span>
          </div>
          <div>
            <span className="text-zinc-400 block text-[10px] uppercase tracking-wider">Policy Hash</span>
            <code className="font-mono text-[11px] text-zinc-800">{tState?.policyHash || '—'}</code>
          </div>
        </div>
      </div>

      {derivedStatus === 'NO_DATA' && (
        <div className="bg-amber-50/60 border border-amber-200/70 rounded-xl p-4 text-xs text-amber-800 flex items-start gap-3">
          <HelpCircle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">No operational telemetry received yet</p>
            <p className="mt-0.5 text-amber-700">
              This installation has not connected to the telemetry service. Possible reasons: the agent is running in standalone mode, is an older agent version without fleet reporting support, or network traffic to the telemetry endpoints is blocked.
            </p>
          </div>
        </div>
      )}

      {/* Administrative Commands Panel */}
      <div className="border border-zinc-200 rounded-xl p-4 bg-white space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Remote Device Commands
            </h4>
            <p className="text-xs text-zinc-500">
              Commands are delivered during the agent&apos;s next telemetry ping response.
            </p>
          </div>

          {canManage && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedCommand('force_policy_refresh')}
                className="text-xs h-8"
              >
                <RefreshCw className="h-3 w-3 mr-1.5" />
                Refresh Policy
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedCommand('request_diagnostic_snapshot')}
                className="text-xs h-8"
              >
                <Terminal className="h-3 w-3 mr-1.5" />
                Request Diagnostics
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedCommand('request_service_restart')}
                className="text-xs h-8"
              >
                <RotateCcw className="h-3 w-3 mr-1.5" />
                Restart Service
              </Button>
            </div>
          )}
        </div>

        {/* Command history list */}
        {commands.length > 0 ? (
          <div className="overflow-x-auto border-t border-zinc-100 pt-3">
            <Table>
              <TableHeader>
                <TableRow className="text-[11px] text-zinc-400">
                  <TableHead className="py-2">Command</TableHead>
                  <TableHead className="py-2">Status</TableHead>
                  <TableHead className="py-2">Issued</TableHead>
                  <TableHead className="py-2">Delivered</TableHead>
                  <TableHead className="py-2">Result</TableHead>
                  <TableHead className="py-2 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {commands.slice(0, 5).map((cmd) => (
                  <TableRow key={cmd.id} className="text-xs">
                    <TableCell className="font-mono text-[11px] py-2">
                      {cmd.commandType}
                    </TableCell>
                    <TableCell className="py-2">
                      <span
                        className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          cmd.status === 'ACKNOWLEDGED'
                            ? 'bg-emerald-50 text-emerald-700'
                            : cmd.status === 'DELIVERED'
                            ? 'bg-blue-50 text-blue-700'
                            : cmd.status === 'PENDING'
                            ? 'bg-amber-50 text-amber-700'
                            : 'bg-zinc-100 text-zinc-600'
                        }`}
                      >
                        {cmd.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-zinc-500 py-2">{fmtDateTime(cmd.issuedAt)}</TableCell>
                    <TableCell className="text-zinc-500 py-2">{fmtDateTime(cmd.deliveredAt)}</TableCell>
                    <TableCell className="py-2">
                      {cmd.result ? (
                        <span
                          className={`text-[11px] ${
                            cmd.result === 'success' ? 'text-emerald-600' : 'text-red-600'
                          }`}
                        >
                          {cmd.result}
                        </span>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="text-right py-2">
                      <div className="flex items-center justify-end gap-1.5">
                        {cmd.resultDetail && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-[11px]"
                            onClick={() => setViewingDetail(cmd.resultDetail ?? null)}
                          >
                            <Eye className="h-3 w-3 mr-1" />
                            View
                          </Button>
                        )}
                        {canManage && cmd.status === 'PENDING' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-[11px] text-red-600 hover:text-red-700"
                            onClick={() => handleCancelCommand(cmd.id)}
                          >
                            Cancel
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="text-xs text-zinc-400 py-2">No command history for this device.</p>
        )}
      </div>

      {/* Scans & History */}
      <div className="border border-zinc-200 rounded-xl p-4 bg-white space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Recent Scans (Last 20)
        </h4>

        {scans.length > 0 ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="text-[11px] text-zinc-400">
                  <TableHead>Type</TableHead>
                  <TableHead>Target Summary</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Files</TableHead>
                  <TableHead>PII Files</TableHead>
                  <TableHead>Highest Tier</TableHead>
                  <TableHead className="text-right">Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {scans.map((scan) => (
                  <TableRow key={scan.id} className="text-xs hover:bg-zinc-50/60">
                    <TableCell className="font-medium">
                      {scan.scanSource === 'full_system_scan' ? 'Full System' : 'Directory'}
                    </TableCell>
                    <TableCell className="text-zinc-600 truncate max-w-[160px]">
                      {scan.targetSummary || 'Default'}
                    </TableCell>
                    <TableCell className="text-zinc-500">{fmtDateTime(scan.startedAt)}</TableCell>
                    <TableCell className="text-zinc-500">{scan.durationSeconds}s</TableCell>
                    <TableCell className="text-zinc-800">{scan.filesScanned}</TableCell>
                    <TableCell className="text-zinc-800 font-semibold">{scan.filesWithPii}</TableCell>
                    <TableCell>
                      {scan.highestTier ? (
                        <Badge
                          variant="outline"
                          className={TIER_BADGE_CLASSES[scan.highestTier] || 'bg-zinc-100 text-zinc-700'}
                        >
                          {scan.highestTier}
                        </Badge>
                      ) : (
                        <span className="text-zinc-400">None</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-[11px]"
                        onClick={() => handleViewScanDetail(scan)}
                      >
                        Inspect
                        <ChevronRight className="h-3 w-3 ml-1" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="text-xs text-zinc-400 py-3">No scan runs recorded yet for this installation.</p>
        )}
      </div>

      {/* Enforcement Activity (7 Days) */}
      <div className="border border-zinc-200 rounded-xl p-4 bg-white space-y-4">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Real-Time DLP Enforcement Activity (7 Days)
        </h4>

        {enforcementChartData.length > 0 ? (
          <div className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={enforcementChartData}>
                <XAxis dataKey="date" fontSize={11} stroke="#94a3b8" />
                <YAxis fontSize={11} stroke="#94a3b8" />
                <RechartsTooltip />
                <Legend />
                <Bar dataKey="block" fill="#ef4444" name="Block" />
                <Bar dataKey="quarantine" fill="#f59e0b" name="Quarantine" />
                <Bar dataKey="override" fill="#8b5cf6" name="Override" />
                <Bar dataKey="warn" fill="#3b82f6" name="Warn" />
                <Bar dataKey="allow" fill="#10b981" name="Allow" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-xs text-zinc-400 py-4">No DLP enforcement events reported in the last 7 days.</p>
        )}
      </div>

      {/* Command confirmation modal */}
      <Dialog open={!!selectedCommand} onOpenChange={(open) => !open && !issuingCommand && setSelectedCommand(null)}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>
              {selectedCommand === 'force_policy_refresh' && 'Force Policy Refresh?'}
              {selectedCommand === 'request_service_restart' && 'Restart ClAIssify Service?'}
              {selectedCommand === 'request_diagnostic_snapshot' && 'Request Diagnostic Snapshot?'}
            </DialogTitle>
            <DialogDescription>
              {selectedCommand === 'force_policy_refresh' &&
                'The agent will immediately check in with the licensing server and synchronize sensitivity tier enforcement policies.'}
              {selectedCommand === 'request_service_restart' &&
                'The background ClAIssify Windows service will be gracefully restarted on the endpoint device. File monitoring will temporarily pause for ~5 seconds.'}
              {selectedCommand === 'request_diagnostic_snapshot' &&
                'The agent will report non-sensitive diagnostic metrics (versions, uptime, outbox depth, OS) back in its next ping response.'}
            </DialogDescription>
          </DialogHeader>

          {commandError && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2.5">
              {commandError}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedCommand(null)} disabled={issuingCommand}>
              Cancel
            </Button>
            <Button
              onClick={() => selectedCommand && handleIssueCommand(selectedCommand)}
              disabled={issuingCommand}
            >
              {issuingCommand ? 'Issuing...' : 'Confirm Command'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diagnostics detail viewer modal */}
      <Dialog open={!!viewingDetail} onOpenChange={(open) => !open && setViewingDetail(null)}>
        <DialogContent className="sm:max-w-[540px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Terminal className="h-4 w-4 text-blue-500" />
              Diagnostic Snapshot Payload
            </DialogTitle>
            <DialogDescription className="text-xs">
              Operational metrics reported by the agent. Zero PII or file contents are included.
            </DialogDescription>
          </DialogHeader>
          <pre className="p-3 bg-zinc-900 text-zinc-100 rounded-lg text-xs font-mono overflow-auto max-h-72">
            {(() => {
              try {
                return JSON.stringify(JSON.parse(viewingDetail || '{}'), null, 2);
              } catch {
                return viewingDetail;
              }
            })()}
          </pre>
          <DialogFooter>
            <Button size="sm" onClick={() => setViewingDetail(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Scan Detail Drawer / Modal */}
      <Dialog open={!!selectedScanRun} onOpenChange={(open) => !open && setSelectedScanRun(null)}>
        <DialogContent className="sm:max-w-[700px] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2">
              <FileCheck className="h-4 w-4 text-blue-600" />
              Scan Run Details: {selectedScanRun?.clientScanId.slice(0, 8)}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Summary of findings and capped high-sensitivity file records.
            </DialogDescription>
          </DialogHeader>

          {selectedScanRun && (
            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-4 gap-2 bg-zinc-50 p-3 rounded-lg border border-zinc-200">
                <div>
                  <span className="text-zinc-400 block text-[10px] uppercase">Files Scanned</span>
                  <span className="font-semibold text-zinc-800">{selectedScanRun.filesScanned}</span>
                </div>
                <div>
                  <span className="text-zinc-400 block text-[10px] uppercase">With PII</span>
                  <span className="font-semibold text-zinc-800">{selectedScanRun.filesWithPii}</span>
                </div>
                <div>
                  <span className="text-zinc-400 block text-[10px] uppercase">Total Findings</span>
                  <span className="font-semibold text-zinc-800">{selectedScanRun.totalFindings}</span>
                </div>
                <div>
                  <span className="text-zinc-400 block text-[10px] uppercase">Highest Tier</span>
                  <span className="font-semibold text-zinc-800">{selectedScanRun.highestTier || 'None'}</span>
                </div>
              </div>

              {selectedScanRun.findings && selectedScanRun.findings.length > 0 ? (
                <div className="space-y-2">
                  <h5 className="font-semibold text-zinc-700">
                    High Sensitivity Files ({selectedScanRun.findings.length})
                  </h5>
                  <div className="max-h-60 overflow-y-auto border border-zinc-200 rounded-lg">
                    <Table>
                      <TableHeader>
                        <TableRow className="text-[11px] text-zinc-400">
                          <TableHead>Path Reference</TableHead>
                          <TableHead>Tier</TableHead>
                          <TableHead>Entities Detected</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selectedScanRun.findings.map((f) => (
                          <TableRow key={f.id} className="text-xs">
                            <TableCell className="font-mono text-[11px] truncate max-w-[200px]" title={f.pathRef}>
                              {f.pathRef}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className={TIER_BADGE_CLASSES[f.tier] || ''}>
                                {f.tier}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-1">
                                {Object.entries(f.entityTypeCounts || {}).map(([ent, cnt]) => (
                                  <span
                                    key={ent}
                                    className="bg-zinc-100 text-zinc-700 px-1.5 py-0.5 rounded text-[10px]"
                                  >
                                    {ent}: {cnt}
                                  </span>
                                ))}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              ) : (
                <p className="text-zinc-400 text-xs py-2">
                  {scanDetailLoading ? 'Loading finding details...' : 'No per-file finding records captured.'}
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button size="sm" onClick={() => setSelectedScanRun(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
