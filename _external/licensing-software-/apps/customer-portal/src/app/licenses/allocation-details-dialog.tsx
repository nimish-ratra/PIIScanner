'use client';

import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { apiClient, ApiError } from '@/lib/api-client';
import { LicenseAllocation } from '@/lib/types';
import { Hash, Building2, Package, Calendar, Layers, PauseCircle, PlayCircle, Ban } from 'lucide-react';
import { ALLOCATION_STATUS_CONFIG, ALLOCATION_VALID_TRANSITIONS, AllocationStatus } from './allocation-status';

function DetailRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2.5" style={{ borderBottom: '1px solid oklch(0.95 0 0)' }}>
      <Icon className="h-3.5 w-3.5 text-zinc-300 mt-0.5 shrink-0" />
      <span className="text-xs text-zinc-400 w-28 shrink-0">{label}</span>
      <span className="text-xs text-zinc-800 font-medium break-all">{value}</span>
    </div>
  );
}

const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString() : '—');

type ConfirmAction = 'suspend' | 'reactivate' | 'revoke';

interface AllocationDetailsDialogProps {
  allocation: LicenseAllocation;
  canManage: boolean;
  onClose: () => void;
  onChanged: () => void;
}

export function AllocationDetailsDialog({ allocation, canManage, onClose, onChanged }: AllocationDetailsDialogProps) {
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const status = allocation.status as AllocationStatus;
  const statusCfg = ALLOCATION_STATUS_CONFIG[status] ?? { label: allocation.status, classes: '' };
  const allowedTransitions = ALLOCATION_VALID_TRANSITIONS[status] ?? [];
  const available = allocation.quantity - allocation.consumedQuantity;

  const runAction = async (action: ConfirmAction) => {
    setSubmitting(true);
    setError(null);
    try {
      await apiClient(`/licenses/${allocation.id}/${action}`, { method: 'POST' });
      setConfirmAction(null);
      onChanged();
      onClose();
    } catch (err: any) {
      setError(err instanceof ApiError ? err.message : 'Action failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const actionCopy: Record<ConfirmAction, { title: string; description: React.ReactNode; confirmLabel: string; variant: 'default' | 'destructive' }> = {
    suspend: {
      title: 'Suspend Allocation?',
      description: 'Devices drawing seats from this batch will be told to stop functioning on their next check-in. Seats already consumed remain counted against this batch — this does not free them.',
      confirmLabel: 'Suspend',
      variant: 'default',
    },
    reactivate: {
      title: 'Reactivate Allocation?',
      description: 'Devices drawing seats from this batch will resume normal operation on their next check-in.',
      confirmLabel: 'Reactivate',
      variant: 'default',
    },
    revoke: {
      title: 'Revoke Allocation?',
      description: 'This permanently ends this batch. This cannot be undone — a new allocation would need to be created from the entitlement to reissue these seats.',
      confirmLabel: 'Revoke Allocation',
      variant: 'destructive',
    },
  };

  return (
    <>
      <Dialog open={!confirmAction} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold text-zinc-800 flex items-center gap-2">
              <Layers className="h-4 w-4 text-zinc-400" />
              Allocation #{allocation.id.slice(0, 8).toUpperCase()}
            </DialogTitle>
            <DialogDescription className="text-xs text-zinc-400">
              A batch of seats sub-allocated from your entitlement to one company
            </DialogDescription>
          </DialogHeader>

          <div className="mt-1">
            <DetailRow icon={Hash} label="Allocation ID" value={<code className="text-[11px]">{allocation.id}</code>} />
            <DetailRow icon={Building2} label="Company" value={allocation.company?.name ?? allocation.companyId} />
            <DetailRow icon={Package} label="Entitlement" value={<code className="text-[11px]">{allocation.entitlementId}</code>} />
            <DetailRow
              icon={Layers}
              label="Status"
              value={<Badge variant="outline" className={statusCfg.classes}>{statusCfg.label}</Badge>}
            />
            <DetailRow icon={Layers} label="Seats" value={`${allocation.consumedQuantity} consumed / ${allocation.quantity} total (${available} available)`} />
            <DetailRow icon={Calendar} label="Created" value={fmtDate(allocation.createdAt)} />
          </div>

          {error && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>
          )}

          {canManage && allowedTransitions.length > 0 && (
            <DialogFooter className="!justify-end sm:!justify-end">
              <div className="flex gap-2">
                {status === 'ACTIVE' && allowedTransitions.includes('SUSPENDED') && (
                  <Button variant="outline" size="sm" onClick={() => setConfirmAction('suspend')} disabled={submitting}>
                    <PauseCircle className="h-3.5 w-3.5" />
                    Suspend
                  </Button>
                )}
                {status === 'SUSPENDED' && allowedTransitions.includes('ACTIVE') && (
                  <Button variant="outline" size="sm" onClick={() => setConfirmAction('reactivate')} disabled={submitting}>
                    <PlayCircle className="h-3.5 w-3.5" />
                    Reactivate
                  </Button>
                )}
                {allowedTransitions.includes('REVOKED') && (
                  <Button variant="destructive" size="sm" onClick={() => setConfirmAction('revoke')} disabled={submitting}>
                    <Ban className="h-3.5 w-3.5" />
                    Revoke
                  </Button>
                )}
              </div>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      {/* Confirmation step — separate dialog so the detail view underneath stays mounted */}
      <Dialog open={!!confirmAction} onOpenChange={(open) => !open && !submitting && setConfirmAction(null)}>
        <DialogContent className="sm:max-w-[420px]">
          {confirmAction && (
            <>
              <DialogHeader>
                <DialogTitle>{actionCopy[confirmAction].title}</DialogTitle>
                <DialogDescription>{actionCopy[confirmAction].description}</DialogDescription>
              </DialogHeader>
              {error && (
                <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirmAction(null)} disabled={submitting}>
                  Cancel
                </Button>
                <Button
                  variant={actionCopy[confirmAction].variant}
                  onClick={() => runAction(confirmAction)}
                  disabled={submitting}
                >
                  {submitting ? 'Working...' : actionCopy[confirmAction].confirmLabel}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
