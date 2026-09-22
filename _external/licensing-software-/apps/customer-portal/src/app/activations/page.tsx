'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/state';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/components/providers/auth-provider';
import { Activation, ActivationStatus } from '@/lib/types';
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
import { KeyRound, ChevronRight, RotateCw } from 'lucide-react';
import { ACTIVATION_STATUS_CONFIG } from './activation-status';
import { ActivationDetailsDialog } from './activation-details-dialog';

const STATUS_FILTERS: Array<'ALL' | ActivationStatus> = [
  'ALL', 'PENDING', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED', 'REVOKED', 'EXPIRED',
];

const fmtDateTime = (d?: string | null) => (d ? new Date(d).toLocaleString() : '—');

export default function ActivationsPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [activations, setActivations] = useState<Activation[]>([]);
  const [statusFilter, setStatusFilter] = useState<'ALL' | ActivationStatus>('ALL');
  const [selected, setSelected] = useState<Activation | null>(null);

  const canManage = user.roles.includes('EnterpriseAdmin') || user.roles.includes('CompanyAdmin');

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiClient<Activation[]>('/activations');
      setActivations(res);
    } catch (err: any) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData, user]);

  const filtered = statusFilter === 'ALL'
    ? activations
    : activations.filter((a) => a.status === statusFilter);

  return (
    <div>
      <PageHeader
        title="Activations"
        description="License rights issued by the Trustfabric licensing system for approved employee requests"
        actions={
          <Button variant="outline" size="sm" onClick={loadData}>
            <RotateCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        }
      />

      {/* loading/error are rendered inline rather than as early returns — a
          background refresh (e.g. after suspend/revoke) must never unmount
          ActivationDetailsDialog while it's open. */}
      {loading ? (
        <LoadingState message="Loading activations..." />
      ) : error ? (
        <ErrorState error={error} onRetry={loadData} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter((v ?? 'ALL') as typeof statusFilter)}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                {STATUS_FILTERS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s === 'ALL' ? 'All statuses' : ACTIVATION_STATUS_CONFIG[s].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              title="No Activations Found"
              description="Activations appear here once a Customer Admin approves a license request naming a specific employee — the Trustfabric licensing backend issues them automatically."
              action={<Button variant="outline" onClick={loadData}>Refresh</Button>}
            />
          ) : (
            <div className="rounded-md border bg-white shadow-sm overflow-x-auto">
              <Table>
                <TableHeader className="bg-slate-50">
                  <TableRow>
                    <TableHead>Status</TableHead>
                    <TableHead>Employee</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead>Activated</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead>Installation</TableHead>
                    <TableHead className="text-right"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((a) => {
                    const cfg = ACTIVATION_STATUS_CONFIG[a.status] ?? { label: a.status, classes: '' };
                    const employeeName = a.user?.name || a.user?.email || a.userId;
                    return (
                      <TableRow key={a.id} className="cursor-pointer" onClick={() => setSelected(a)}>
                        <TableCell>
                          <Badge variant="outline" className={cfg.classes}>
                            {cfg.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-medium flex items-center gap-2">
                          <KeyRound className="h-4 w-4 text-slate-400" />
                          {employeeName}
                        </TableCell>
                        <TableCell>{a.product?.name ?? a.productId}</TableCell>
                        <TableCell>{a.company?.name ?? a.companyId}</TableCell>
                        <TableCell className="text-slate-500">{fmtDateTime(a.activatedAt)}</TableCell>
                        <TableCell className="text-slate-500">{fmtDateTime(a.expiresAt)}</TableCell>
                        <TableCell className="text-slate-500">
                          {a.installationId ? <code className="text-[11px]">{a.installationId.slice(0, 8)}…</code> : '—'}
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
        </>
      )}

      {selected && (
        <ActivationDetailsDialog
          activation={selected}
          canManage={canManage}
          onClose={() => setSelected(null)}
          onChanged={loadData}
        />
      )}
    </div>
  );
}
