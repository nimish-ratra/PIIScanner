'use client';

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/state';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/components/providers/auth-provider';
import { Installation, InstallationStatus } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Monitor, ChevronRight, RotateCw } from 'lucide-react';
import { INSTALLATION_STATUS_CONFIG } from './installation-status';
import { InstallationDetailsDialog } from './installation-details-dialog';

const STATUS_FILTERS: Array<'ALL' | InstallationStatus> = [
  'ALL', 'ACTIVE', 'PENDING', 'INACTIVE', 'SUSPENDED', 'REVOKED',
];

export default function InstallationsPage() {
  const { selectedCompanyId, user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [statusFilter, setStatusFilter] = useState<'ALL' | InstallationStatus>('ALL');
  const [platformFilter, setPlatformFilter] = useState<string>('ALL');
  const [selected, setSelected] = useState<Installation | null>(null);

  const canManage = user.roles.includes('EnterpriseAdmin') || user.roles.includes('CompanyAdmin');

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const queryParams = new URLSearchParams();
      if (selectedCompanyId !== '*') {
        queryParams.append('companyId', selectedCompanyId);
      }
      if (statusFilter !== 'ALL') {
        queryParams.append('status', statusFilter);
      }

      const res = await apiClient<Installation[]>(`/installations?${queryParams.toString()}`);
      setInstallations(res);
    } catch (err: any) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [selectedCompanyId, statusFilter]);

  useEffect(() => {
    loadData();
  }, [loadData, user]);

  // Reset the (client-side) platform filter if it no longer applies after a refetch
  const platforms = useMemo(
    () => Array.from(new Set(installations.map((i) => i.os).filter(Boolean))) as string[],
    [installations],
  );

  const filtered = platformFilter === 'ALL'
    ? installations
    : installations.filter((i) => i.os === platformFilter);

  if (loading) return <LoadingState message="Loading endpoint telemetry..." />;
  if (error) return <ErrorState error={error} onRetry={loadData} />;

  return (
    <div>
      <PageHeader
        title="Installations"
        description="Monitor active endpoint agents and license consumption"
        actions={
          <Button variant="outline" size="sm" onClick={loadData}>
            <RotateCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        }
      />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter((v ?? 'ALL') as typeof statusFilter)}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTERS.map((s) => (
              <SelectItem key={s} value={s}>
                {s === 'ALL' ? 'All statuses' : INSTALLATION_STATUS_CONFIG[s].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {platforms.length > 1 && (
          <Select value={platformFilter} onValueChange={(v) => setPlatformFilter(v ?? 'ALL')}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Platform" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All platforms</SelectItem>
              {platforms.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="No Installations Found"
          description="There are currently no endpoint installations matching this filter."
          action={<Button variant="outline" onClick={loadData}>Refresh</Button>}
        />
      ) : (
        <div className="rounded-md border bg-white shadow-sm overflow-x-auto">
          <Table>
            <TableHeader className="bg-slate-50">
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>Hostname</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>OS</TableHead>
                <TableHead>Agent Ver</TableHead>
                <TableHead>Last Heartbeat</TableHead>
                <TableHead className="text-right"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((inst) => {
                const cfg = INSTALLATION_STATUS_CONFIG[inst.status] ?? { label: inst.status, classes: '' };
                return (
                  <TableRow
                    key={inst.id}
                    className="cursor-pointer"
                    onClick={() => setSelected(inst)}
                  >
                    <TableCell>
                      <Badge variant="outline" className={cfg.classes}>
                        {cfg.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium flex items-center gap-2">
                      <Monitor className="h-4 w-4 text-slate-400" />
                      {inst.hostname || <span className="text-slate-400 italic">Unnamed</span>}
                    </TableCell>
                    <TableCell>{inst.company?.name ?? inst.companyId}</TableCell>
                    <TableCell>{[inst.os, inst.osVersion].filter(Boolean).join(' ') || '—'}</TableCell>
                    <TableCell>{inst.agentVersion || '—'}</TableCell>
                    <TableCell className="text-slate-500">
                      {inst.lastHeartbeatAt ? new Date(inst.lastHeartbeatAt).toLocaleString() : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <ChevronRight className="h-4 w-4 text-slate-300 inline-block" />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {selected && (
        <InstallationDetailsDialog
          installation={selected}
          canManage={canManage}
          onClose={() => setSelected(null)}
          onChanged={loadData}
        />
      )}
    </div>
  );
}
