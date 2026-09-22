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
import type { Customer } from '@/lib/types';
import { Search, ChevronRight, Building2, Plus } from 'lucide-react';
import { CreateCustomerDialog } from './create-customer-dialog';
import { CustomerDetailsDialog } from './customer-details-dialog';

type StatusFilter = 'ALL' | 'ACTIVE' | 'INACTIVE';

export default function CustomersPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const loadData = React.useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiClient<Customer[]>('/customers');
      setCustomers(res);
    } catch (err: any) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData, user]);

  const filtered = customers.filter((c) => {
    if (statusFilter !== 'ALL' && c.status !== statusFilter) return false;
    if (searchQuery && !c.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="max-w-[1400px] mx-auto pb-12 flex flex-col h-[calc(100vh-8rem)]">
      {/* A background reload (e.g. after creating a customer) must never
          unmount CreateCustomerDialog while it's showing the one-time
          password — so loading/error/table states are inline below, not an
          early `return`, and the dialogs are always-present siblings. */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 shrink-0">
        <PageHeader title="Customers" description="Enterprises licensed on the Trustfabric platform" />
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-3.5 w-3.5" /> Create Customer
        </Button>
      </div>

      {loading ? (
        <LoadingState message="Loading customers..." />
      ) : error ? (
        <ErrorState error={error} onRetry={loadData} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-4 shrink-0">
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
              <input
                type="text"
                placeholder="Search customers..."
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
                <SelectItem value="ALL">All statuses</SelectItem>
                <SelectItem value="ACTIVE">Active</SelectItem>
                <SelectItem value="INACTIVE">Inactive</SelectItem>
              </SelectContent>
            </Select>
            <div className="text-xs text-zinc-500 font-medium bg-white px-2.5 py-1 rounded-md border border-zinc-200 shadow-sm shrink-0 ml-auto">
              {filtered.length} of {customers.length}
            </div>
          </div>

          <div className="bg-white border border-zinc-200 rounded-xl flex flex-col flex-1 min-h-0 shadow-sm overflow-hidden">
            <div className="flex-1 overflow-auto bg-white">
              {customers.length === 0 ? (
                <EmptyState title="No customers yet" description="Create the first customer to start issuing entitlements." />
              ) : filtered.length === 0 ? (
                <div className="p-12 text-center text-zinc-500 text-sm">No customers match your filters.</div>
              ) : (
                <Table>
                  <TableHeader className="bg-slate-50 sticky top-0 z-10 shadow-sm">
                    <TableRow>
                      <TableHead className="font-semibold">Customer</TableHead>
                      <TableHead className="font-semibold">Companies</TableHead>
                      <TableHead className="font-semibold">Entitlements</TableHead>
                      <TableHead className="font-semibold">Status</TableHead>
                      <TableHead className="text-right"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((c) => (
                      <TableRow key={c.id} className="hover:bg-zinc-50/50 cursor-pointer" onClick={() => setSelectedId(c.id)}>
                        <TableCell className="font-medium text-zinc-900 flex items-center gap-2">
                          <Building2 className="h-4 w-4 text-zinc-400" />
                          {c.name}
                        </TableCell>
                        <TableCell className="tabular-nums">{c._count?.companies ?? 0}</TableCell>
                        <TableCell className="tabular-nums">{c._count?.entitlements ?? 0}</TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={c.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : ''}
                          >
                            {c.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <ChevronRight className="h-4 w-4 text-zinc-300 inline-block" />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </div>
        </>
      )}

      <CreateCustomerDialog
        isOpen={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => {
          // Deliberately does NOT auto-open the details dialog — the credential
          // dialog stays open on top showing the one-time password, and
          // stacking a second dialog over it would block interacting with it
          // (its overlay covers the "Done" button). The vendor can click the
          // row afterward if they want details.
          loadData();
        }}
      />
      {selectedId && (
        <CustomerDetailsDialog customerId={selectedId} onClose={() => { setSelectedId(null); loadData(); }} />
      )}
    </div>
  );
}
