'use client';

import React, { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LoadingState, ErrorState } from '@/components/ui/state';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { apiClient, ApiError } from '@/lib/api-client';
import type { Customer } from '@/lib/types';
import { Building2, Package, Info, Plus } from 'lucide-react';

export function CustomerDetailsDialog({ customerId, onClose }: { customerId: string; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [togglingStatus, setTogglingStatus] = useState(false);

  const [addingCompany, setAddingCompany] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState('');
  const [addCompanyError, setAddCompanyError] = useState<string | null>(null);
  const [savingCompany, setSavingCompany] = useState(false);

  const loadCustomer = React.useCallback(() => {
    setLoading(true);
    setError(null);
    apiClient<Customer>(`/customers/${customerId}`)
      .then(setCustomer)
      .catch((err) => setError(err))
      .finally(() => setLoading(false));
  }, [customerId]);

  useEffect(() => {
    loadCustomer();
  }, [loadCustomer]);

  const toggleStatus = async () => {
    if (!customer) return;
    const nextStatus = customer.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    setTogglingStatus(true);
    try {
      await apiClient(`/customers/${customer.id}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: nextStatus }),
      });
      loadCustomer();
    } catch (err: any) {
      setError(err);
    } finally {
      setTogglingStatus(false);
    }
  };

  const totalEntitled = customer?.entitlements?.reduce((sum, e) => sum + e.quantity, 0) ?? 0;
  const totalAllocated = customer?.entitlements?.reduce((sum, e) => sum + e.allocatedQuantity, 0) ?? 0;

  const handleAddCompany = async () => {
    if (!customer) return;
    if (!newCompanyName.trim()) {
      setAddCompanyError('Company name is required.');
      return;
    }
    setSavingCompany(true);
    setAddCompanyError(null);
    try {
      await apiClient(`/customers/${customer.id}/companies`, {
        method: 'POST',
        body: JSON.stringify({ name: newCompanyName.trim() }),
      });
      setNewCompanyName('');
      setAddingCompany(false);
      loadCustomer();
    } catch (err: any) {
      setAddCompanyError(err instanceof ApiError ? err.message : 'Failed to add company.');
    } finally {
      setSavingCompany(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold text-zinc-800 flex items-center gap-2">
            <Building2 className="h-4 w-4 text-zinc-400" />
            {customer?.name ?? 'Customer'}
            {customer && (
              <Badge
                variant="outline"
                className={customer.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : ''}
              >
                {customer.status}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription className="text-xs text-zinc-400">
            Companies and entitlements provisioned to this customer
          </DialogDescription>
        </DialogHeader>

        {loading && <LoadingState message="Loading customer..." />}
        {error && <ErrorState error={error} onRetry={loadCustomer} />}

        {customer && (
          <>
            <div className="grid grid-cols-3 gap-3 py-2">
              <div className="rounded-lg border border-zinc-100 bg-zinc-50/60 p-3">
                <div className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide">Companies</div>
                <div className="text-lg font-bold text-zinc-900 tabular-nums">{customer.companies?.length ?? 0}</div>
              </div>
              <div className="rounded-lg border border-zinc-100 bg-zinc-50/60 p-3">
                <div className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide">Entitled</div>
                <div className="text-lg font-bold text-zinc-900 tabular-nums">{totalEntitled.toLocaleString()}</div>
              </div>
              <div className="rounded-lg border border-zinc-100 bg-zinc-50/60 p-3">
                <div className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide">Allocated</div>
                <div className="text-lg font-bold text-blue-600 tabular-nums">{totalAllocated.toLocaleString()}</div>
              </div>
            </div>

            <div className="pb-1">
              <div className="flex flex-wrap items-center gap-1.5">
                {customer.companies?.map((co) => (
                  <Badge key={co.id} variant="secondary" className="font-normal">
                    {co.name}
                  </Badge>
                ))}
                {!addingCompany && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 px-2 text-[11px]"
                    onClick={() => setAddingCompany(true)}
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Add Company
                  </Button>
                )}
              </div>

              {addingCompany && (
                <div className="flex items-start gap-2 mt-2">
                  <div className="flex-1">
                    <Input
                      autoFocus
                      placeholder="Company name (e.g. Acme UK)"
                      value={newCompanyName}
                      onChange={(e) => {
                        setNewCompanyName(e.target.value);
                        setAddCompanyError(null);
                      }}
                      disabled={savingCompany}
                      className="h-8 text-xs"
                    />
                    {addCompanyError && <p className="text-[11px] text-red-600 mt-1">{addCompanyError}</p>}
                  </div>
                  <Button size="sm" className="h-8" onClick={handleAddCompany} disabled={savingCompany}>
                    {savingCompany ? 'Adding...' : 'Add'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8"
                    disabled={savingCompany}
                    onClick={() => {
                      setAddingCompany(false);
                      setNewCompanyName('');
                      setAddCompanyError(null);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              )}
            </div>

            <div className="max-h-[38vh] overflow-y-auto -mx-1 px-1">
              {!customer.entitlements || customer.entitlements.length === 0 ? (
                <p className="text-xs text-zinc-400 py-6 text-center">No entitlements issued to this customer yet.</p>
              ) : (
                <Table>
                  <TableHeader className="bg-slate-50 sticky top-0">
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead>Seats</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Expires</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {customer.entitlements.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="font-medium flex items-center gap-2">
                          <Package className="h-3.5 w-3.5 text-zinc-400" />
                          {e.product?.name ?? e.productId}
                          {e.edition?.name && <span className="text-zinc-400 font-normal">— {e.edition.name}</span>}
                        </TableCell>
                        <TableCell>{e.allocatedQuantity} / {e.quantity}</TableCell>
                        <TableCell>
                          <Badge variant={e.status === 'ACTIVE' ? 'default' : e.status === 'EXPIRED' ? 'destructive' : 'secondary'}>
                            {e.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-zinc-500 text-sm">
                          {new Date(e.endDate).toLocaleDateString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 pt-1">
              <div className="flex items-start gap-2 text-xs text-zinc-500">
                <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>User management for this customer happens in the Customer Portal.</span>
              </div>
              <Button variant="outline" size="sm" onClick={toggleStatus} disabled={togglingStatus} className="shrink-0">
                {customer.status === 'ACTIVE' ? 'Disable Customer' : 'Enable Customer'}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
