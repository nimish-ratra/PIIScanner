'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { apiClient, ApiError } from '@/lib/api-client';
import { Company, LicenseAllocation, EnrollmentToken, EnrollmentTokenCreated } from '@/lib/types';
import { Copy, Check, ShieldAlert, Download } from 'lucide-react';

type TokenMode = 'single' | 'bulk';

function downloadEnrollmentTokensCsv(tokens: EnrollmentTokenCreated[]) {
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const header = ['token', 'label', 'expiresAt', 'maxActivations'].join(',');
  const rows = tokens.map((t) =>
    [escape(t.token), escape(t.label ?? ''), escape(t.expiresAt), String(t.maxActivations)].join(','),
  );
  const csv = [header, ...rows].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `enrollment-tokens-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

interface CreateEnrollmentTokenDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  companies: Company[];
  allocations: LicenseAllocation[];
  /** All enrollment tokens the panel already loaded — used to compute how
   * many more activations can still be issued against a given allocation. */
  tokens: EnrollmentToken[];
  /** Pre-select a company (e.g. when the portal is scoped to a single company). */
  defaultCompanyId?: string;
  /** Pre-select an allocation — e.g. right after that batch was created. */
  defaultAllocationId?: string;
  /** Open straight into bulk/CSV mode — e.g. right after a batch was allocated. */
  defaultMode?: TokenMode;
  onSuccess: () => void;
}

export function CreateEnrollmentTokenDialog({
  isOpen,
  onOpenChange,
  companies,
  allocations,
  tokens,
  defaultCompanyId,
  defaultAllocationId,
  defaultMode,
  onSuccess,
}: CreateEnrollmentTokenDialogProps) {
  const [mode, setMode] = useState<TokenMode>('single');
  const [companyId, setCompanyId] = useState('');
  const [allocationId, setAllocationId] = useState('');
  const [label, setLabel] = useState('');
  const [maxActivations, setMaxActivations] = useState<number | ''>(1);
  const [quantity, setQuantity] = useState<number | ''>(10);
  const [expiresInDays, setExpiresInDays] = useState<number | ''>(30);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<EnrollmentTokenCreated | null>(null);
  const [createdBulk, setCreatedBulk] = useState<EnrollmentTokenCreated[] | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const preselected = defaultAllocationId
        ? allocations.find((a) => a.id === defaultAllocationId)
        : undefined;
      setMode(defaultMode ?? 'single');
      setCompanyId(preselected?.companyId ?? (defaultCompanyId && defaultCompanyId !== '*' ? defaultCompanyId : ''));
      setAllocationId(defaultAllocationId ?? '');
      setLabel('');
      setMaxActivations(1);
      setQuantity(10);
      setExpiresInDays(30);
      setError(null);
      setCreated(null);
      setCreatedBulk(null);
      setCopied(false);
    }
  }, [isOpen, defaultCompanyId, defaultAllocationId, defaultMode, allocations]);

  const allocationsForCompany = allocations.filter((a) => a.companyId === companyId);
  const selectedAllocation = allocations.find((a) => a.id === allocationId);

  // Mirrors the backend's EnrollmentTokensService.assertIssuable() for UI
  // affordance only — the backend is the actual enforcer. Excludes
  // activation-bound tokens (activationId set) since their seat is already
  // reserved in the allocation's consumedQuantity, not held back by the
  // voucher itself.
  const outstandingForAllocation = useMemo(() => {
    if (!allocationId) return 0;
    const now = Date.now();
    return tokens
      .filter(
        (t) =>
          t.allocationId === allocationId &&
          !t.activationId &&
          !t.revokedAt &&
          new Date(t.expiresAt).getTime() > now,
      )
      .reduce((sum, t) => sum + Math.max(0, t.maxActivations - t.activationsUsed), 0);
  }, [tokens, allocationId]);

  const availableSeats = selectedAllocation ? selectedAllocation.quantity - selectedAllocation.consumedQuantity : 0;
  const issuable = Math.max(0, availableSeats - outstandingForAllocation);
  const requestedActivations = mode === 'bulk' ? Number(quantity || 0) : Number(maxActivations || 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!companyId) {
      setError('Please select a company.');
      return;
    }
    if (!allocationId) {
      setError('Please select an allocation.');
      return;
    }
    if (requestedActivations > issuable) {
      setError(
        `Only ${issuable} more activation(s) can be issued against this allocation right now ` +
          `(${availableSeats} seat(s) available, ${outstandingForAllocation} already reserved by unredeemed tokens).`,
      );
      return;
    }

    if (mode === 'bulk') {
      const qty = quantity === '' ? 0 : Number(quantity);
      if (!Number.isInteger(qty) || qty < 1) {
        setError('Quantity must be a positive whole number.');
        return;
      }
      if (qty > 500) {
        setError('Maximum 500 tokens per batch.');
        return;
      }

      setSubmitting(true);
      try {
        const result = await apiClient<EnrollmentTokenCreated[]>(
          `/companies/${companyId}/enrollment-tokens/bulk`,
          {
            method: 'POST',
            body: JSON.stringify({
              allocationId,
              quantity: qty,
              label: label.trim() || undefined,
              expiresInDays: expiresInDays === '' ? undefined : Number(expiresInDays),
            }),
          },
        );
        setCreatedBulk(result);
        onSuccess();
      } catch (err: any) {
        setError(err instanceof ApiError ? err.message : 'Failed to generate enrollment tokens.');
      } finally {
        setSubmitting(false);
      }
      return;
    }

    setSubmitting(true);
    try {
      const result = await apiClient<EnrollmentTokenCreated>(
        `/companies/${companyId}/enrollment-tokens`,
        {
          method: 'POST',
          body: JSON.stringify({
            allocationId,
            label: label.trim() || undefined,
            maxActivations: maxActivations === '' ? undefined : Number(maxActivations),
            expiresInDays: expiresInDays === '' ? undefined : Number(expiresInDays),
          }),
        },
      );
      setCreated(result);
      onSuccess();
    } catch (err: any) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to create enrollment token.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopy = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable — the token is still selectable/visible in the field.
    }
  };

  const handleClose = () => {
    onOpenChange(false);
  };

  // ─── Bulk success state: tokens are only ever available via the CSV download ──
  if (createdBulk) {
    return (
      <Dialog open={isOpen} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>{createdBulk.length} Enrollment Tokens Generated</DialogTitle>
            <DialogDescription>
              Each code is single-use. Download the CSV now — the plaintext tokens cannot be
              retrieved again once you close this dialog.
            </DialogDescription>
          </DialogHeader>

          <div className="py-2 space-y-3">
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-md p-3 text-xs text-amber-800">
              <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                This is the only time these tokens are available. The server stores only their
                hashes — they cannot be recovered later.
              </span>
            </div>

            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => downloadEnrollmentTokensCsv(createdBulk)}
            >
              <Download className="h-4 w-4" />
              Download CSV ({createdBulk.length} tokens)
            </Button>

            <dl className="text-xs text-slate-500 grid grid-cols-2 gap-y-1">
              <dt>Max activations (each)</dt>
              <dd className="text-slate-800 font-medium">1</dd>
              <dt>Expires</dt>
              <dd className="text-slate-800 font-medium">{new Date(createdBulk[0].expiresAt).toLocaleString()}</dd>
            </dl>
          </div>

          <DialogFooter>
            <Button type="button" onClick={handleClose}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // ─── Success state: show the plaintext token exactly once ──────────────────
  if (created) {
    return (
      <Dialog open={isOpen} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Enrollment Token Created</DialogTitle>
            <DialogDescription>
              Copy this token now — it will not be shown again. Provide it to the device being
              enrolled; it is redeemed once via the agent&apos;s registration step.
            </DialogDescription>
          </DialogHeader>

          <div className="py-2 space-y-3">
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-md p-3 text-xs text-amber-800">
              <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                This is the only time the plaintext token is available. The server stores only its
                hash — it cannot be recovered later.
              </span>
            </div>

            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={created.token}
                className="font-mono text-xs"
                onFocus={(e) => e.currentTarget.select()}
              />
              <Button type="button" variant="outline" size="icon" onClick={handleCopy} title="Copy token">
                {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>

            <dl className="text-xs text-slate-500 grid grid-cols-2 gap-y-1">
              <dt>Max activations</dt>
              <dd className="text-slate-800 font-medium">{created.maxActivations}</dd>
              <dt>Expires</dt>
              <dd className="text-slate-800 font-medium">{new Date(created.expiresAt).toLocaleString()}</dd>
            </dl>
          </div>

          <DialogFooter>
            <Button type="button" onClick={handleClose}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // ─── Form state ──────────────────────────────────────────────────────────
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !submitting && onOpenChange(open)}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>{mode === 'bulk' ? 'Generate Enrollment Tokens (CSV)' : 'Generate Enrollment Token'}</DialogTitle>
          <DialogDescription>
            {mode === 'bulk'
              ? 'Mint a batch of individual single-use codes — one per device — downloadable as a CSV.'
              : 'Create a token that a device can redeem once to register and consume a seat.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-2">
            {error && (
              <div className="bg-red-50 text-red-600 text-sm p-3 rounded-md border border-red-200">
                {error}
              </div>
            )}

            <div className="grid grid-cols-2 gap-1 bg-slate-100 p-1 rounded-lg">
              <button
                type="button"
                onClick={() => setMode('single')}
                disabled={submitting}
                className={`text-sm py-1.5 rounded-md transition-colors ${
                  mode === 'single' ? 'bg-white shadow-sm font-medium text-slate-900' : 'text-slate-500'
                }`}
              >
                Single Token
              </button>
              <button
                type="button"
                onClick={() => setMode('bulk')}
                disabled={submitting}
                className={`text-sm py-1.5 rounded-md transition-colors ${
                  mode === 'bulk' ? 'bg-white shadow-sm font-medium text-slate-900' : 'text-slate-500'
                }`}
              >
                Bulk (CSV)
              </button>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="et-company">Company</Label>
              <Select
                value={companyId}
                onValueChange={(v) => {
                  setCompanyId(v ?? '');
                  setAllocationId('');
                }}
                disabled={submitting}
              >
                <SelectTrigger id="et-company" className="w-full">
                  <SelectValue placeholder="Select a company" />
                </SelectTrigger>
                <SelectContent>
                  {companies.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="et-allocation">Allocation</Label>
              <Select
                value={allocationId}
                onValueChange={(v) => setAllocationId(v ?? '')}
                disabled={submitting || !companyId}
              >
                <SelectTrigger id="et-allocation" className="w-full">
                  <SelectValue
                    placeholder={companyId ? 'Select an allocation' : 'Select a company first'}
                  />
                </SelectTrigger>
                <SelectContent>
                  {allocationsForCompany.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.quantity - a.consumedQuantity} of {a.quantity} seats available
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {companyId && allocationsForCompany.length === 0 && (
                <p className="text-xs text-slate-400">This company has no allocations yet.</p>
              )}
              {selectedAllocation && (
                <p className={`text-xs ${issuable === 0 ? 'text-amber-600' : 'text-slate-400'}`}>
                  {availableSeats} seat(s) available · {outstandingForAllocation} already reserved by
                  unredeemed tokens · up to <span className="font-medium">{issuable}</span> more can be issued
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="et-label">Label (optional)</Label>
              <Input
                id="et-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Q1 Windows rollout"
                disabled={submitting}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              {mode === 'bulk' ? (
                <div className="space-y-1.5">
                  <Label htmlFor="et-quantity">Quantity</Label>
                  <Input
                    id="et-quantity"
                    type="number"
                    min={1}
                    max={500}
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value ? Number(e.target.value) : '')}
                    disabled={submitting}
                  />
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor="et-max">Max activations</Label>
                  <Input
                    id="et-max"
                    type="number"
                    min={1}
                    value={maxActivations}
                    onChange={(e) => setMaxActivations(e.target.value ? Number(e.target.value) : '')}
                    disabled={submitting}
                  />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="et-expires">Expires in (days)</Label>
                <Input
                  id="et-expires"
                  type="number"
                  min={1}
                  value={expiresInDays}
                  onChange={(e) => setExpiresInDays(e.target.value ? Number(e.target.value) : '')}
                  disabled={submitting}
                />
              </div>
            </div>
            {mode === 'bulk' && (
              <p className="text-xs text-slate-400 -mt-2">
                Each of the {quantity || 0} codes is single-use (max activations: 1).
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Generating...' : mode === 'bulk' ? 'Generate Tokens' : 'Generate Token'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
