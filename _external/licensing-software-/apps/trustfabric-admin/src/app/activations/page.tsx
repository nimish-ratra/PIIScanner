'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/state';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/components/providers/auth-provider';
import { Activation, ActivationStatus, Customer } from '@/lib/types';
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
import { KeyRound, ChevronRight, RotateCw, Search, ArrowUpDown } from 'lucide-react';
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
  const [companyFilter, setCompanyFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortByCompany, setSortByCompany] = useState(false);
  const [selected, setSelected] = useState<Activation | null>(null);
  const [allCompanies, setAllCompanies] = useState<Array<[string, string]>>([]);

  // The vendor API (VendorActivationsController) returns every Activation
  // across every customer in one response and takes no query params —
  // filtering/sorting here is client-side over that already-authoritative
  // global dataset, matching the existing vendor Installations page pattern.
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

  // The Customer filter must list every company that exists, not just ones
  // that already happen to have an Activation — otherwise a newly onboarded
  // customer with entitlements but no activations yet is invisible in the
  // dropdown. /vendor/customers only returns enterprises with a companies
  // count, so fetch each enterprise's detail (which nests its companies) and
  // flatten — same per-entity-fetch pattern as the customer portal's
  // enrollment-tokens panel.
  const loadCompanies = useCallback(async () => {
    try {
      const customers = await apiClient<Customer[]>('/customers');
      const details = await Promise.all(
        customers.map((c) => apiClient<Customer>(`/customers/${c.id}`).catch(() => null)),
      );
      const map = new Map<string, string>();
      details.forEach((detail) => {
        detail?.companies?.forEach((co) => map.set(co.id, co.name));
      });
      setAllCompanies(Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1])));
    } catch {
      // Non-fatal — the Customer filter just won't be offered if this fails.
    }
  }, []);

  useEffect(() => {
    loadData();
    loadCompanies();
  }, [loadData, loadCompanies, user]);

  const filtered = activations.filter((a) => {
    if (statusFilter !== 'ALL' && a.status !== statusFilter) return false;
    if (companyFilter !== 'ALL' && a.companyId !== companyFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchesEmployee = (a.user?.name ?? a.user?.email ?? a.userId).toLowerCase().includes(q);
      const matchesCompany = (a.company?.name ?? '').toLowerCase().includes(q);
      const matchesProduct = (a.product?.name ?? '').toLowerCase().includes(q);
      if (!matchesEmployee && !matchesCompany && !matchesProduct) return false;
    }
    return true;
  });

  const sorted = sortByCompany
    ? [...filtered].sort((a, b) => (a.company?.name ?? a.companyId).localeCompare(b.company?.name ?? b.companyId))
    : filtered;

  return (
    <div className="max-w-[1400px] mx-auto pb-12 flex flex-col h-[calc(100vh-8rem)]">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 shrink-0">
        <PageHeader
          title="Activations"
          description="Global visibility and lifecycle control over license rights issued by the Trustfabric licensing backend, across every customer"
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
            placeholder="Search employee, customer, or product..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow bg-white"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter((v ?? 'ALL') as typeof statusFilter)}>
          <SelectTrigger className="w-[170px]">
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

        {allCompanies.length > 1 && (
          <Select value={companyFilter} onValueChange={(v) => setCompanyFilter(v ?? 'ALL')}>
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder="Customer" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All customers</SelectItem>
              {allCompanies.map(([id, name]) => (
                <SelectItem key={id} value={id}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Button
          variant={sortByCompany ? 'default' : 'outline'}
          size="sm"
          onClick={() => setSortByCompany((v) => !v)}
          title="Sort by company"
        >
          <ArrowUpDown className="h-3.5 w-3.5" />
          Sort by Company
        </Button>
      </div>

      {loading ? (
        <LoadingState message="Loading activations..." />
      ) : error ? (
        <ErrorState error={error} onRetry={loadData} />
      ) : (
        <div className="bg-white border border-zinc-200 rounded-xl flex flex-col flex-1 min-h-0 shadow-sm overflow-hidden">
          <div className="flex-1 overflow-auto bg-white flex flex-col">
            {sorted.length === 0 ? (
              <div className="flex-1 flex items-center justify-center bg-zinc-50/30">
                <EmptyState
                  title="No Activations Found"
                  description="Activations appear here once a Customer Admin approves a license request naming a specific employee — the Trustfabric licensing backend issues them automatically."
                />
              </div>
            ) : (
              <Table>
                <TableHeader className="bg-slate-50 sticky top-0 z-10 shadow-sm">
                  <TableRow>
                    <TableHead className="font-semibold">Status</TableHead>
                    <TableHead className="font-semibold">Employee</TableHead>
                    <TableHead className="font-semibold">Customer</TableHead>
                    <TableHead className="font-semibold">Product</TableHead>
                    <TableHead className="font-semibold">Activated</TableHead>
                    <TableHead className="font-semibold">Expires</TableHead>
                    <TableHead className="font-semibold">Installation</TableHead>
                    <TableHead className="text-right"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sorted.map((a) => {
                    const cfg = ACTIVATION_STATUS_CONFIG[a.status] ?? { label: a.status, classes: '' };
                    const employeeName = a.user?.name || a.user?.email || a.userId;
                    return (
                      <TableRow key={a.id} className="hover:bg-zinc-50/50 cursor-pointer" onClick={() => setSelected(a)}>
                        <TableCell>
                          <Badge variant="outline" className={cfg.classes}>
                            {cfg.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-medium flex items-center gap-2 text-zinc-900">
                          <KeyRound className="h-4 w-4 text-zinc-400" />
                          {employeeName}
                        </TableCell>
                        <TableCell className="text-zinc-600 font-medium">{a.company?.name ?? a.companyId}</TableCell>
                        <TableCell className="text-zinc-600">{a.product?.name ?? a.productId}</TableCell>
                        <TableCell className="text-zinc-500 text-sm">{fmtDateTime(a.activatedAt)}</TableCell>
                        <TableCell className="text-zinc-500 text-sm">{fmtDateTime(a.expiresAt)}</TableCell>
                        <TableCell className="text-zinc-500 text-sm">
                          {a.installationId ? <code className="text-[11px]">{a.installationId.slice(0, 8)}…</code> : '—'}
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

      {selected && (
        <ActivationDetailsDialog activation={selected} onClose={() => setSelected(null)} onChanged={loadData} />
      )}
    </div>
  );
}
