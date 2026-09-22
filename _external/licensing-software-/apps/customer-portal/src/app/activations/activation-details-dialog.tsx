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
import { Input } from '@/components/ui/input';
import { apiClient, ApiError } from '@/lib/api-client';
import { Activation, EnrollmentTokenCreated } from '@/lib/types';
import {
  Hash, User, Building2, Package, Calendar, Monitor, FileText,
  PauseCircle, PlayCircle, Ban, KeyRound, Copy, Check, ShieldAlert,
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

interface ActivationDetailsDialogProps {
  activation: Activation;
  canManage: boolean;
  onClose: () => void;
  onChanged: () => void;
}

export function ActivationDetailsDialog({
  activation,
  canManage,
  onClose,
  onChanged,
}: ActivationDetailsDialogProps) {
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Only set after successfully minting a replacement enrollment token for a
  // DEACTIVATED activation (device replacement) — shown exactly once, same
  // one-time-secret discipline as every other credential in this app.
  const [replacementToken, setReplacementToken] = useState<EnrollmentTokenCreated | null>(null);
  const [copied, setCopied] = useState(false);

  const status = activation.status;
  const statusCfg = ACTIVATION_STATUS_CONFIG[status] ?? { label: status, classes: '' };
  const allowedTransitions = ACTIVATION_VALID_TRANSITIONS[status] ?? [];
  const employeeName = activation.user?.name || activation.user?.email || activation.userId;

  const runAction = async (action: ConfirmAction) => {
    const endpoint = action === 'reactivate' ? 'reactivate' : action; // suspend | reactivate | revoke — same names as the API routes
    setSubmitting(true);
    setError(null);
    try {
      await apiClient(`/activations/${activation.id}/${endpoint}`, { method: 'POST' });
      // Close entirely rather than reopening the detail view with a now-stale
      // `activation` prop — the parent refetches and the list re-renders fresh.
      setConfirmAction(null);
      onChanged();
      onClose();
    } catch (err: any) {
      setError(err instanceof ApiError ? err.message : 'Action failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const mintReplacement = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const result = await apiClient<{ activation: Activation; enrollmentToken: EnrollmentTokenCreated }>(
        `/activations/${activation.id}/reactivate-enrollment`,
        { method: 'POST' },
      );
      onChanged();
      setReplacementToken(result.enrollmentToken);
    } catch (err: any) {
      setError(err instanceof ApiError ? err.message : 'Failed to generate a replacement enrollment code.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopyToken = async () => {
    if (!replacementToken) return;
    try {
      await navigator.clipboard.writeText(replacementToken.token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable — the token is still selectable/visible in the field.
    }
  };

  const actionCopy: Record<ConfirmAction, { title: string; description: React.ReactNode; confirmLabel: string; variant: 'default' | 'destructive' }> = {
    suspend: {
      title: 'Suspend Activation?',
      description: `${employeeName}'s access will be blocked on their agent's next check-in. The seat remains reserved to this Activation — it is not freed.`,
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
      description: 'This permanently withdraws the license right and frees its seat back to the allocation. This cannot be undone — a new license request would need to be approved to reissue one.',
      confirmLabel: 'Revoke Activation',
      variant: 'destructive',
    },
  };

  // ─── Replacement enrollment code: shown exactly once ───────────────────
  if (replacementToken) {
    return (
      <Dialog open onOpenChange={onClose}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
              <KeyRound className="h-4 w-4 text-zinc-400" />
              Replacement Enrollment Code
            </DialogTitle>
            <DialogDescription className="text-xs text-zinc-400">
              For {employeeName}'s replacement device — this Activation is unchanged, no new seat is consumed.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2 space-y-3">
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-md p-3 text-xs text-amber-800">
              <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
              <span>This code is shown only this once. Copy it now and give it to the employee for their new device's Windows Agent.</span>
            </div>
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={replacementToken.token}
                className="font-mono text-xs"
                onFocus={(e) => e.currentTarget.select()}
              />
              <Button type="button" variant="outline" size="icon" onClick={handleCopyToken} title="Copy code">
                {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" onClick={onClose}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

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
              License right issued by the Trustfabric licensing system for this employee
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[60vh] overflow-y-auto pr-1">
            <SectionLabel>Identity</SectionLabel>
            <DetailRow icon={Hash} label="Activation ID" value={<code className="text-[11px]">{activation.id}</code>} />
            <DetailRow icon={User} label="Employee" value={employeeName} />
            <DetailRow icon={Package} label="Product" value={activation.product?.name ?? activation.productId} />
            {activation.edition && <DetailRow icon={Package} label="Edition" value={activation.edition.name} />}

            <SectionLabel>Ownership</SectionLabel>
            <DetailRow icon={Building2} label="Company" value={activation.company?.name ?? activation.companyId} />
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

          {canManage && (allowedTransitions.length > 0 || status === 'DEACTIVATED') && (
            <DialogFooter className="!justify-between sm:!justify-between">
              <div>
                {status === 'DEACTIVATED' && (
                  <Button variant="outline" size="sm" onClick={mintReplacement} disabled={submitting}>
                    <KeyRound className="h-3.5 w-3.5" />
                    Generate Replacement Enrollment
                  </Button>
                )}
              </div>
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
