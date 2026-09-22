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
import { Input } from '@/components/ui/input';
import { LoadingState, ErrorState } from '@/components/ui/state';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { apiClient, ApiError } from '@/lib/api-client';
import type { Entitlement } from '@/lib/types';
import { Package, Building2, Calendar, Hash, AlertTriangle } from 'lucide-react';

function DetailRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2" style={{ borderBottom: '1px solid oklch(0.95 0 0)' }}>
      <Icon className="h-3.5 w-3.5 text-zinc-300 mt-0.5 shrink-0" />
      <span className="text-xs text-zinc-400 w-28 shrink-0">{label}</span>
      <span className="text-xs text-zinc-800 font-medium">{value}</span>
    </div>
  );
}

type LifecycleAction = 'SUSPENDED' | 'ACTIVE' | 'REVOKED';

const ACTION_COPY: Record<LifecycleAction, { label: string; confirm: string }> = {
  SUSPENDED: { label: 'Suspend', confirm: 'Suspend this entitlement? Companies will be unable to draw new seats from it until reactivated.' },
  ACTIVE: { label: 'Reactivate', confirm: 'Reactivate this entitlement?' },
  REVOKED: { label: 'Revoke', confirm: 'Revoke this entitlement permanently? This cannot be undone — the entitlement can never be reactivated, extended, or resized again.' },
};

export function EntitlementDetailsDialog({ entitlementId, onClose }: { entitlementId: string; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [entitlement, setEntitlement] = useState<Entitlement | null>(null);

  const [pendingAction, setPendingAction] = useState<LifecycleAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  const [extending, setExtending] = useState(false);
  const [newEndDate, setNewEndDate] = useState('');
  const [extendError, setExtendError] = useState<string | null>(null);

  const [adjustingQuantity, setAdjustingQuantity] = useState(false);
  const [newQuantity, setNewQuantity] = useState<number | ''>('');
  const [quantityError, setQuantityError] = useState<string | null>(null);

  const loadEntitlement = React.useCallback(() => {
    setLoading(true);
    setError(null);
    apiClient<Entitlement>(`/entitlements/${entitlementId}`)
      .then((e) => {
        setEntitlement(e);
        setNewEndDate(e.endDate.slice(0, 10));
        setNewQuantity(e.quantity);
      })
      .catch((err) => setError(err))
      .finally(() => setLoading(false));
  }, [entitlementId]);

  useEffect(() => {
    loadEntitlement();
  }, [loadEntitlement]);

  const runStatusChange = async (status: LifecycleAction) => {
    setActionBusy(true);
    setActionError(null);
    try {
      await apiClient(`/entitlements/${entitlementId}/status`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      });
      setPendingAction(null);
      loadEntitlement();
    } catch (err: any) {
      setActionError(err instanceof ApiError ? err.message : 'Failed to update status.');
    } finally {
      setActionBusy(false);
    }
  };

  const submitExtend = async () => {
    setExtendError(null);
    if (!newEndDate) {
      setExtendError('Pick a new end date.');
      return;
    }
    setActionBusy(true);
    try {
      await apiClient(`/entitlements/${entitlementId}/extend`, {
        method: 'POST',
        body: JSON.stringify({ endDate: newEndDate }),
      });
      setExtending(false);
      loadEntitlement();
    } catch (err: any) {
      setExtendError(err instanceof ApiError ? err.message : 'Failed to extend entitlement.');
    } finally {
      setActionBusy(false);
    }
  };

  const submitQuantity = async () => {
    setQuantityError(null);
    if (newQuantity === '' || newQuantity <= 0) {
      setQuantityError('Enter a positive quantity.');
      return;
    }
    setActionBusy(true);
    try {
      await apiClient(`/entitlements/${entitlementId}/quantity`, {
        method: 'POST',
        body: JSON.stringify({ quantity: Number(newQuantity) }),
      });
      setAdjustingQuantity(false);
      loadEntitlement();
    } catch (err: any) {
      setQuantityError(err instanceof ApiError ? err.message : 'Failed to update quantity.');
    } finally {
      setActionBusy(false);
    }
  };

  const isRevoked = entitlement?.status === 'REVOKED';
  const availableActions: LifecycleAction[] =
    entitlement?.status === 'ACTIVE' ? ['SUSPENDED', 'REVOKED']
    : entitlement?.status === 'SUSPENDED' ? ['ACTIVE', 'REVOKED']
    : [];

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold text-zinc-800 flex items-center gap-2">
            <Package className="h-4 w-4 text-zinc-400" />
            {entitlement?.product?.name ?? 'Entitlement'}
            {entitlement?.edition?.name && <span className="text-zinc-400 font-normal">— {entitlement.edition.name}</span>}
          </DialogTitle>
          <DialogDescription className="text-xs text-zinc-400">
            Full entitlement record and company allocations
          </DialogDescription>
        </DialogHeader>

        {loading && <LoadingState message="Loading entitlement..." />}
        {error && <ErrorState error={error} onRetry={loadEntitlement} />}

        {entitlement && (
          <>
            <div className="max-h-[55vh] overflow-y-auto pr-1">
              {entitlement.reference && (
                <DetailRow icon={Hash} label="Reference" value={<code className="text-[11px]">{entitlement.reference}</code>} />
              )}
              <DetailRow icon={Hash} label="Entitlement ID" value={<code className="text-[11px]">{entitlement.id}</code>} />
              <DetailRow icon={Building2} label="Customer" value={entitlement.enterprise?.name ?? entitlement.enterpriseId} />
              <DetailRow icon={Package} label="Product" value={entitlement.product?.name ?? entitlement.productId} />
              <DetailRow
                icon={Hash}
                label="Status"
                value={
                  <Badge variant={entitlement.status === 'ACTIVE' ? 'default' : entitlement.status === 'EXPIRED' ? 'destructive' : 'secondary'}>
                    {entitlement.status}
                  </Badge>
                }
              />
              <DetailRow icon={Hash} label="Quantity" value={`${entitlement.allocatedQuantity} / ${entitlement.quantity} allocated`} />
              <DetailRow icon={Calendar} label="Effective" value={new Date(entitlement.startDate).toLocaleDateString()} />
              <DetailRow icon={Calendar} label="Expires" value={new Date(entitlement.endDate).toLocaleDateString()} />

              {/* Lifecycle actions */}
              <div className="mt-4 mb-2">
                <div className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mb-2">Lifecycle</div>

                {pendingAction ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <div className="flex items-start gap-2 text-xs text-amber-800 mb-3">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      <span>{ACTION_COPY[pendingAction].confirm}</span>
                    </div>
                    {actionError && <p className="text-xs text-red-600 mb-2">{actionError}</p>}
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => setPendingAction(null)} disabled={actionBusy}>
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        variant={pendingAction === 'REVOKED' ? 'destructive' : 'default'}
                        onClick={() => runStatusChange(pendingAction)}
                        disabled={actionBusy}
                      >
                        {actionBusy ? 'Working...' : `Confirm ${ACTION_COPY[pendingAction].label}`}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {availableActions.map((action) => (
                      <Button
                        key={action}
                        variant={action === 'REVOKED' ? 'destructive' : 'outline'}
                        size="sm"
                        onClick={() => setPendingAction(action)}
                      >
                        {ACTION_COPY[action].label}
                      </Button>
                    ))}
                    {!isRevoked && (
                      <Button variant="outline" size="sm" onClick={() => setExtending((v) => !v)}>
                        Extend
                      </Button>
                    )}
                    {!isRevoked && (
                      <Button variant="outline" size="sm" onClick={() => setAdjustingQuantity((v) => !v)}>
                        Adjust Quantity
                      </Button>
                    )}
                    {availableActions.length === 0 && isRevoked && (
                      <span className="text-xs text-zinc-400 italic">Revoked entitlements are terminal — no further lifecycle actions.</span>
                    )}
                  </div>
                )}

                {extending && !pendingAction && (
                  <div className="mt-2 rounded-lg border border-zinc-200 p-3 flex items-end gap-2">
                    <div className="flex-1 space-y-1">
                      <label className="text-xs text-zinc-500">New end date (must be later than the current one)</label>
                      <Input type="date" value={newEndDate} onChange={(e) => setNewEndDate(e.target.value)} disabled={actionBusy} />
                      {extendError && <p className="text-xs text-red-600">{extendError}</p>}
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setExtending(false)} disabled={actionBusy}>
                      Cancel
                    </Button>
                    <Button size="sm" onClick={submitExtend} disabled={actionBusy}>
                      {actionBusy ? 'Saving...' : 'Save'}
                    </Button>
                  </div>
                )}

                {adjustingQuantity && !pendingAction && (
                  <div className="mt-2 rounded-lg border border-zinc-200 p-3 flex items-end gap-2">
                    <div className="flex-1 space-y-1">
                      <label className="text-xs text-zinc-500">
                        New quantity (cannot go below {entitlement.allocatedQuantity} already allocated)
                      </label>
                      <Input
                        type="number"
                        min={entitlement.allocatedQuantity}
                        value={newQuantity}
                        onChange={(e) => setNewQuantity(e.target.value ? Number(e.target.value) : '')}
                        disabled={actionBusy}
                      />
                      {quantityError && <p className="text-xs text-red-600">{quantityError}</p>}
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setAdjustingQuantity(false)} disabled={actionBusy}>
                      Cancel
                    </Button>
                    <Button size="sm" onClick={submitQuantity} disabled={actionBusy}>
                      {actionBusy ? 'Saving...' : 'Save'}
                    </Button>
                  </div>
                )}
              </div>

              <div className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mt-4 mb-2">
                Allocations ({entitlement.allocations?.length ?? 0})
              </div>
              {!entitlement.allocations || entitlement.allocations.length === 0 ? (
                <p className="text-xs text-zinc-400 py-4 text-center">No companies have been allocated seats from this entitlement yet.</p>
              ) : (
                <Table>
                  <TableHeader className="bg-slate-50">
                    <TableRow>
                      <TableHead>Company</TableHead>
                      <TableHead>Seats</TableHead>
                      <TableHead>Consumed</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entitlement.allocations.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell className="font-medium">{a.company?.name ?? a.companyId}</TableCell>
                        <TableCell>{a.quantity}</TableCell>
                        <TableCell>{a.consumedQuantity}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{a.status}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
