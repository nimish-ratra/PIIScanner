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
import { Activation } from '@/lib/types';
import {
  Hash, User, Building2, Package, Calendar, Monitor, FileText,
  PauseCircle, PlayCircle, Ban, KeyRound, ShieldAlert,
} from 'lucide-react';
import { ACTIVATION_STATUS_CONFIG, ACTIVATION_VALID_TRANSITIONS } from './activation-status';

function DetailRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2.5" style={{ borderBottom: '1px solid oklch(0.95 0 0)' }}>
      <Icon className="h-3.5 w-3.5 text-zinc-300 mt-0.5 shrink-0" />
      <span className="text-xs text-zinc-400 w-32 shrink-0">{label}</span>
      <span className="text-xs text-zinc-800 font-medium break-all">{value}</span>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mt-4 mb-1 first:mt-0">
      {children}
    </div>
  );
}

const fmtDateTime = (d?: string | null) => (d ? new Date(d).toLocaleString() : '—');

type ConfirmAction = 'suspend' | 'reactivate' | 'revoke';

/**
 * Vendor-side Activation detail view. Unlike the vendor Installations
 * dialog (deliberately read-only), lifecycle actions ARE exposed here —
 * vendor support/operations may need to suspend or revoke a specific
 * employee's license right directly, across any customer, without waiting
 * on that customer's own admin. Issuing a NEW Activation is never possible
 * from here — that remains exclusively an automatic consequence of a
 * Customer Admin's own approval (see docs/activation-domain.md).
 */
export function ActivationDetailsDialog({
  activation,
  onClose,
  onChanged,
}: {
  activation: Activation;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const status = activation.status;
  const statusCfg = ACTIVATION_STATUS_CONFIG[status] ?? { label: status, classes: '' };
  const allowedTransitions = ACTIVATION_VALID_TRANSITIONS[status] ?? [];
  const employeeName = activation.user?.name || activation.user?.email || activation.userId;

  const runAction = async (action: ConfirmAction) => {
    setSubmitting(true);
    setError(null);
    try {
      await apiClient(`/activations/${activation.id}/${action}`, { method: 'POST' });
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
      title: 'Suspend Activation?',
      description: `${employeeName}'s access will be blocked on their agent's next check-in. The seat remains reserved — this does not free it up. This is a vendor-initiated action, independent of the customer's own admin.`,
      confirmLabel: 'Suspend',
      variant: 'default',
    },
    reactivate: {
      title: 'Reactivate Activation?',
      description: `${employeeName}'s access will be restored on their agent's next check-in.`,
      confirmLabel: 'Reactivate',
      variant: 'default',
    },
    revoke: {
      title: 'Revoke Activation?',
      description: 'This permanently withdraws the license right and frees its seat back to the allocation. This cannot be undone — the customer would need to submit and approve a new license request to reissue one.',
      confirmLabel: 'Revoke Activation',
      variant: 'destructive',
    },
  };

  return (
    <>
      <Dialog open={!confirmAction} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold text-zinc-800 flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-zinc-400" />
              {employeeName}
            </DialogTitle>
            <DialogDescription className="text-xs text-zinc-400">
              Global Activation record (vendor scope) — issued automatically by the Trustfabric licensing backend
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[60vh] overflow-y-auto pr-1">
            <SectionLabel>Identity</SectionLabel>
            <DetailRow icon={Hash} label="Activation ID" value={<code className="text-[11px]">{activation.id}</code>} />
            <DetailRow icon={User} label="Employee" value={employeeName} />
            <DetailRow icon={Package} label="Product" value={activation.product?.name ?? activation.productId} />
            {activation.edition && <DetailRow icon={Package} label="Edition" value={activation.edition.name} />}

            <SectionLabel>Ownership</SectionLabel>
            <DetailRow icon={Building2} label="Customer / Company" value={activation.company?.name ?? activation.companyId} />
            <DetailRow icon={FileText} label="Request" value={<code className="text-[11px]">{activation.requestId}</code>} />

            <SectionLabel>Status</SectionLabel>
            <DetailRow
              icon={ShieldAlert}
              label="Current Status"
              value={<Badge variant="outline" className={statusCfg.classes}>{statusCfg.label}</Badge>}
            />
            {activation.installationId ? (
              <DetailRow icon={Monitor} label="Installation" value={<code className="text-[11px]">{activation.installationId}</code>} />
            ) : (
              <DetailRow icon={Monitor} label="Installation" value={<span className="text-zinc-400 italic font-normal">Not yet linked to a device</span>} />
            )}

            <SectionLabel>Lifecycle</SectionLabel>
            <DetailRow icon={Calendar} label="Issued" value={fmtDateTime(activation.createdAt)} />
            <DetailRow icon={Calendar} label="Activated" value={fmtDateTime(activation.activatedAt)} />
            <DetailRow icon={Calendar} label="Expires" value={fmtDateTime(activation.expiresAt)} />
            {activation.revokedAt && <DetailRow icon={Calendar} label="Revoked" value={fmtDateTime(activation.revokedAt)} />}
          </div>

          {error && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>
          )}

          {allowedTransitions.length > 0 && (
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
