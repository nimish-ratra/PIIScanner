'use client';

import React, { useEffect, useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/state';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/components/providers/auth-provider';
import { Entitlement } from '@/lib/types';
import { Search, ChevronRight, Plus } from 'lucide-react';
import { EntitlementDetailsDialog } from './entitlement-details-dialog';
import { CreateEntitlementDialog } from './create-entitlement-dialog';

type StatusFilter = 'ALL' | 'ACTIVE' | 'SUSPENDED' | 'EXPIRED' | 'REVOKED';
const STATUS_FILTERS: StatusFilter[] = ['ALL', 'ACTIVE', 'SUSPENDED', 'EXPIRED', 'REVOKED'];

export default function EntitlementsPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [entitlements, setEntitlements] = useState<Entitlement[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const loadData = React.useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiClient<Entitlement[]>('/entitlements');
      setEntitlements(res);
    } catch (err: any) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData, user]);

  const filtered = entitlements.filter((e) => {
    if (statusFilter !== 'ALL' && e.status !== statusFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchesProduct = e.product?.name?.toLowerCase().includes(q);
      const matchesCustomer = e.enterprise?.name?.toLowerCase().includes(q);
      const matchesId = e.id.toLowerCase().includes(q);
      const matchesReference = e.reference?.toLowerCase().includes(q);
      if (!matchesProduct && !matchesCustomer && !matchesId && !matchesReference) return false;
    }
    return true;
  });

  return (
    <div className="max-w-[1400px] mx-auto pb-12 flex flex-col h-[calc(100vh-8rem)]">
      {/* loading/error/table are inline below (not an early `return`) so a
          background reload never unmounts CreateEntitlementDialog/EntitlementDetailsDialog. */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6 shrink-0">
        <PageHeader
          title="Entitlements"
          description="Global view of every commercial grant across all customers"
        />
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-3.5 w-3.5" /> Create Entitlement
        </Button>
      </div>

      {loading ? (
        <LoadingState message="Loading global entitlements..." />
      ) : error ? (
        <ErrorState error={error} onRetry={loadData} />
      ) : (
        <div className="bg-white border border-zinc-200 rounded-xl flex flex-col flex-1 min-h-0 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-zinc-100 flex flex-col sm:flex-row gap-3 items-center justify-between shrink-0 bg-zinc-50/50">
            <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
              <div className="relative w-full sm:w-72">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
                <input
                  type="text"
                  placeholder="Search by customer, product, or ID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow bg-white"
                />
              </div>
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter((v ?? 'ALL') as StatusFilter)}>
                <SelectTrigger className="w-[160px] bg-white">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_FILTERS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s === 'ALL' ? 'All statuses' : s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="text-xs text-zinc-500 font-medium bg-white px-2.5 py-1 rounded-md border border-zinc-200 shadow-sm shrink-0">
              {filtered.length} of {entitlements.length}
            </div>
          </div>

          <div className="flex-1 overflow-auto bg-white">
            {entitlements.length === 0 ? (
              <EmptyState
                title="No entitlements found"
                description="There are currently no entitlements provisioned to any customer."
              />
            ) : filtered.length === 0 ? (
              <div className="p-12 text-center text-zinc-500 text-sm">No entitlements match your filters.</div>
            ) : (
              <Table>
                <TableHeader className="bg-slate-50 sticky top-0 z-10 shadow-sm">
                  <TableRow>
                    <TableHead className="font-semibold">Product</TableHead>
                    <TableHead className="font-semibold">Customer</TableHead>
                    <TableHead className="font-semibold">Entitled</TableHead>
                    <TableHead className="font-semibold">Allocated</TableHead>
                    <TableHead className="font-semibold">Available</TableHead>
                    <TableHead className="font-semibold">Status</TableHead>
                    <TableHead className="font-semibold">Expires</TableHead>
                    <TableHead className="text-right"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((row) => {
                    const available = row.quantity - row.allocatedQuantity;
                    const pct = row.quantity > 0 ? Math.round((row.allocatedQuantity / row.quantity) * 100) : 0;
                    return (
                      <TableRow key={row.id} className="hover:bg-zinc-50/50 cursor-pointer" onClick={() => setSelectedId(row.id)}>
                        <TableCell>
                          <div className="font-medium text-zinc-900">
                            {row.product?.name || 'Unknown Product'}
                            {row.edition?.name && <span className="text-zinc-400 font-normal"> — {row.edition.name}</span>}
                          </div>
                          <div className="text-xs text-zinc-500 font-mono mt-0.5">{row.reference ?? `${row.id.slice(0, 8)}...`}</div>
                        </TableCell>
                        <TableCell className="text-zinc-700 font-medium">{row.enterprise?.name ?? row.enterpriseId}</TableCell>
                        <TableCell className="tabular-nums">{row.quantity.toLocaleString()}</TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1 w-28">
                            <span className="text-sm tabular-nums text-zinc-900">{row.allocatedQuantity.toLocaleString()}</span>
                            <div className="w-full bg-zinc-100 rounded-full h-1.5 overflow-hidden">
                              <div
                                className={`h-1.5 rounded-full ${pct > 90 ? 'bg-amber-500' : 'bg-blue-500'}`}
                                style={{ width: `${Math.min(100, pct)}%` }}
                              />
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="tabular-nums font-medium text-blue-600">{available.toLocaleString()}</TableCell>
                        <TableCell>
                          <Badge variant={row.status === 'ACTIVE' ? 'default' : row.status === 'EXPIRED' ? 'destructive' : 'secondary'}>
                            {row.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-zinc-600 text-sm">
                          {new Date(row.endDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
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
      )}

      <CreateEntitlementDialog
        isOpen={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(entitlement) => {
          loadData();
          setSelectedId(entitlement.id);
        }}
      />
      {selectedId && (
        <EntitlementDetailsDialog entitlementId={selectedId} onClose={() => { setSelectedId(null); loadData(); }} />
      )}
    </div>
  );
}
