'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/state';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/lib/api-client';
import {
  ShieldCheck,
  RotateCw,
  AlertTriangle,
  Monitor,
  Building2,
  Cpu,
  Clock,
  CheckCircle2,
  XCircle,
} from 'lucide-react';

interface VendorFleetHealthResponse {
  totalInstallations: number;
  statusCounts: Record<string, number>;
  agentVersionDistribution: Record<string, number>;
  unseenOver7Days: number;
  companyRollups: Array<{
    companyId: string;
    companyName: string;
    totalInstallations: number;
    liveCount: number;
    staleOrOfflineCount: number;
  }>;
}

export default function VendorFleetHealthPage() {
  const [data, setData] = useState<VendorFleetHealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiClient<VendorFleetHealthResponse>('/telemetry/fleet-health');
      setData(res);
    } catch (err: any) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (loading && !data) {
    return <LoadingState message="Loading cross-company fleet health..." />;
  }

  if (error && !data) {
    return <ErrorState error={error} onRetry={loadData} />;
  }

  const statusCounts = data?.statusCounts || {};
  const versionDist = data?.agentVersionDistribution || {};
  const rollups = data?.companyRollups || [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fleet Health Rollup"
        description="Cross-tenant endpoint health and version adoption metrics for TrustFabric operations staff"
        actions={
          <Button variant="outline" size="sm" onClick={loadData}>
            <RotateCw className="h-3.5 w-3.5 mr-1.5" />
            Refresh
          </Button>
        }
      />

      {/* Privacy Notice Banner */}
      <div className="bg-blue-50/70 border border-blue-200/80 rounded-xl p-4 text-xs text-blue-800 flex items-center gap-3">
        <ShieldCheck className="h-4 w-4 text-blue-600 shrink-0" />
        <p>
          <strong>Privacy Boundary Enforced:</strong> As vendor staff, you have visibility into operational availability, versions, and device health rollups. Zero customer classification findings, file paths, or entity types are ever exposed.
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border border-zinc-200/60 shadow-sm">
          <CardContent className="p-4">
            <span className="text-xs font-medium text-zinc-500">Total Installed Fleet</span>
            <div className="mt-2 text-2xl font-bold text-zinc-900">
              {data?.totalInstallations.toLocaleString() || 0}
            </div>
            <p className="text-[11px] text-zinc-400 mt-1">Endpoints across all tenants</p>
          </CardContent>
        </Card>

        <Card className="border border-zinc-200/60 shadow-sm">
          <CardContent className="p-4">
            <span className="text-xs font-medium text-zinc-500">Live & Reporting</span>
            <div className="mt-2 text-2xl font-bold text-emerald-600">
              {statusCounts.LIVE || 0}
            </div>
            <p className="text-[11px] text-zinc-400 mt-1">
              Active service & timely pings
            </p>
          </CardContent>
        </Card>

        <Card className="border border-zinc-200/60 shadow-sm">
          <CardContent className="p-4">
            <span className="text-xs font-medium text-zinc-500">Stale or Offline</span>
            <div className="mt-2 text-2xl font-bold text-amber-600">
              {(statusCounts.STALE || 0) + (statusCounts.OFFLINE || 0)}
            </div>
            <p className="text-[11px] text-zinc-400 mt-1">Endpoints missing heartbeat/ping</p>
          </CardContent>
        </Card>

        <Card className="border border-zinc-200/60 shadow-sm">
          <CardContent className="p-4">
            <span className="text-xs font-medium text-zinc-500">Unseen in &gt; 7 Days</span>
            <div className="mt-2 text-2xl font-bold text-red-600">
              {data?.unseenOver7Days || 0}
            </div>
            <p className="text-[11px] text-zinc-400 mt-1">Candidates for seat reclamation</p>
          </CardContent>
        </Card>
      </div>

      {/* Grid: Version Distribution & Status Breakdown */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Version Distribution */}
        <Card className="border border-zinc-200/60 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Cpu className="h-4 w-4 text-blue-500" />
              Agent Version Distribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            {Object.keys(versionDist).length > 0 ? (
              <div className="space-y-2">
                {Object.entries(versionDist).map(([ver, count]) => (
                  <div key={ver} className="flex items-center justify-between text-xs py-1 border-b border-zinc-100 last:border-0">
                    <span className="font-mono text-zinc-700">{ver}</span>
                    <span className="font-semibold text-zinc-900">{count} devices</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-zinc-400">No version data reported yet.</p>
            )}
          </CardContent>
        </Card>

        {/* Status Breakdown */}
        <Card className="border border-zinc-200/60 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Monitor className="h-4 w-4 text-purple-500" />
              Status Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between py-1 border-b border-zinc-100">
                <span className="text-zinc-600">Live (Running & Active)</span>
                <Badge variant="outline" className="bg-emerald-50 text-emerald-700 ring-emerald-200">
                  {statusCounts.LIVE || 0}
                </Badge>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-zinc-100">
                <span className="text-zinc-600">Stale (&lt; 30m)</span>
                <Badge variant="outline" className="bg-amber-50 text-amber-700 ring-amber-200">
                  {statusCounts.STALE || 0}
                </Badge>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-zinc-100">
                <span className="text-zinc-600">Service Stopped</span>
                <Badge variant="outline" className="bg-red-50 text-red-700 ring-red-200">
                  {statusCounts.STOPPED || 0}
                </Badge>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-zinc-100">
                <span className="text-zinc-600">Offline (&gt; 30m)</span>
                <Badge variant="outline" className="bg-zinc-100 text-zinc-600 ring-zinc-200">
                  {statusCounts.OFFLINE || 0}
                </Badge>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-zinc-600">No Telemetry / Standalone</span>
                <Badge variant="outline" className="bg-slate-50 text-slate-500 ring-slate-200">
                  {statusCounts.NO_DATA || 0}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Per-Company Rollup Table */}
      <Card className="border border-zinc-200/60 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Building2 className="h-4 w-4 text-blue-500" />
            Customer Company Rollups
          </CardTitle>
        </CardHeader>
        <CardContent>
          {rollups.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="text-[11px] text-zinc-500 uppercase tracking-wider">
                    <TableHead>Company</TableHead>
                    <TableHead className="text-right">Total Installations</TableHead>
                    <TableHead className="text-right">Live Protected</TableHead>
                    <TableHead className="text-right">Stale / Offline</TableHead>
                    <TableHead className="text-right">Health Ratio</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rollups.map((r) => (
                    <TableRow key={r.companyId} className="text-xs">
                      <TableCell className="font-medium text-zinc-900">{r.companyName}</TableCell>
                      <TableCell className="text-right text-zinc-700">{r.totalInstallations}</TableCell>
                      <TableCell className="text-right font-semibold text-emerald-600">{r.liveCount}</TableCell>
                      <TableCell className="text-right text-amber-600">{r.staleOrOfflineCount}</TableCell>
                      <TableCell className="text-right text-zinc-500">
                        {r.totalInstallations > 0
                          ? `${Math.round((r.liveCount / r.totalInstallations) * 100)}%`
                          : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-xs text-zinc-400 py-3">No company data recorded.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
