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
import { Monitor, ChevronRight, RotateCw, Search } from 'lucide-react';
import { INSTALLATION_STATUS_CONFIG } from './installation-status';
import { InstallationDetailsDialog } from './installation-details-dialog';

const STATUS_FILTERS: Array<'ALL' | InstallationStatus> = [
  'ALL', 'ACTIVE', 'PENDING', 'INACTIVE', 'SUSPENDED', 'REVOKED',
];

export default function InstallationsPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [statusFilter, setStatusFilter] = useState<'ALL' | InstallationStatus>('ALL');
  const [companyFilter, setCompanyFilter] = useState<string>('ALL');
  const [platformFilter, setPlatformFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [selected, setSelected] = useState<Installation | null>(null);

  // The vendor API (VendorInstallationsController) returns every installation
  // across every tenant in one response and takes no query params — filtering
  // here is client-side over that already-authoritative global dataset.
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiClient<Installation[]>('/installations');
      setInstallations(res);
    } catch (err: any) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData, user]);

  const companies = useMemo(() => {
    const map = new Map<string, string>();
    installations.forEach((i) => map.set(i.companyId, i.company?.name ?? i.companyId));
    return Array.from(map.entries());
  }, [installations]);

  const platforms = useMemo(
    () => Array.from(new Set(installations.map((i) => i.os).filter(Boolean))) as string[],
    [installations],
  );

  const filtered = installations.filter((i) => {
    if (statusFilter !== 'ALL' && i.status !== statusFilter) return false;
    if (companyFilter !== 'ALL' && i.companyId !== companyFilter) return false;
    if (platformFilter !== 'ALL' && i.os !== platformFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchesHost = i.hostname?.toLowerCase().includes(q);
      const matchesDevice = i.deviceId.toLowerCase().includes(q);
      const matchesCompany = (i.company?.name ?? '').toLowerCase().includes(q);
      if (!matchesHost && !matchesDevice && !matchesCompany) return false;
    }
    return true;
  });

  if (loading) return <LoadingState message="Loading endpoint telemetry..." />;
  if (error) return <ErrorState error={error} onRetry={loadData} />;

  return (
    <div className="max-w-[1400px] mx-auto pb-12 flex flex-col h-[calc(100vh-8rem)]">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 shrink-0">
        <PageHeader
          title="Installations"
          description="Monitor global endpoint agents and license consumption across every customer"
        />
        <Button variant="outline" size="sm" onClick={loadData}>
          <RotateCw className="h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-4 shrink-0">
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
          <input
            type="text"
            placeholder="Search hostname, device, or customer..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow bg-white"
          />
        </div>
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

        {companies.length > 1 && (
          <Select value={companyFilter} onValueChange={(v) => setCompanyFilter(v ?? 'ALL')}>
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder="Company" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All companies</SelectItem>
              {companies.map(([id, name]) => (
                <SelectItem key={id} value={id}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {platforms.length > 1 && (
          <Select value={platformFilter} onValueChange={(v) => setPlatformFilter(v ?? 'ALL')}>
            <SelectTrigger className="w-[180px]">
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

      <div className="bg-white border border-zinc-200 rounded-xl flex flex-col flex-1 min-h-0 shadow-sm overflow-hidden">
        <div className="flex-1 overflow-auto bg-white flex flex-col">
          {filtered.length === 0 ? (
            <div className="flex-1 flex items-center justify-center bg-zinc-50/30">
              <EmptyState
                title="No Installations Found"
                description="There are currently no endpoint installations matching this filter."
              />
            </div>
          ) : (
            <Table>
              <TableHeader className="bg-slate-50 sticky top-0 z-10 shadow-sm">
                <TableRow>
                  <TableHead className="font-semibold">Status</TableHead>
                  <TableHead className="font-semibold">Customer</TableHead>
                  <TableHead className="font-semibold">Hostname</TableHead>
                  <TableHead className="font-semibold">OS</TableHead>
                  <TableHead className="font-semibold">App Ver</TableHead>
                  <TableHead className="font-semibold">Agent Ver</TableHead>
                  <TableHead className="font-semibold">Last Heartbeat</TableHead>
                  <TableHead className="text-right"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((inst) => {
                  const cfg = INSTALLATION_STATUS_CONFIG[inst.status] ?? { label: inst.status, classes: '' };
                  return (
                    <TableRow key={inst.id} className="hover:bg-zinc-50/50 cursor-pointer" onClick={() => setSelected(inst)}>
                      <TableCell>
                        <Badge variant="outline" className={cfg.classes}>
                          {cfg.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-zinc-600 font-medium">{inst.company?.name ?? inst.companyId}</TableCell>
                      <TableCell className="font-medium flex items-center gap-2 text-zinc-900">
                        <Monitor className="h-4 w-4 text-zinc-400" />
                        {inst.hostname || <span className="text-zinc-400 italic">Unnamed</span>}
                      </TableCell>
                      <TableCell className="text-zinc-600">{[inst.os, inst.osVersion].filter(Boolean).join(' ') || '—'}</TableCell>
                      <TableCell className="text-zinc-600 font-mono text-xs">{inst.applicationVersion || '—'}</TableCell>
                      <TableCell className="text-zinc-600 font-mono text-xs">{inst.agentVersion || '—'}</TableCell>
                      <TableCell className="text-zinc-500 text-sm">
                        {inst.lastHeartbeatAt ? new Date(inst.lastHeartbeatAt).toLocaleString() : '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        <ChevronRight className="h-4 w-4 text-zinc-300 inline-block" />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </div>

      {selected && (
        <InstallationDetailsDialog installation={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
