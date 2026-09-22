'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/state';
import { apiClient, ApiError } from '@/lib/api-client';
import { useAuth } from '@/components/providers/auth-provider';
import { LicenseRequest, LicenseRequestApproval, LicenseRequestStatus } from '@/lib/types';
import {
  CheckCircle, XCircle, ChevronRight, Clock, RotateCcw,
  User, Building2, Package, Hash, Calendar, MessageSquare,
  ShieldCheck, ShieldAlert, Copy, Check,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';

// ─── Status helpers ───────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<LicenseRequestStatus, { label: string; classes: string }> = {
  PENDING:   { label: 'Pending',   classes: 'bg-amber-50   text-amber-700  ring-1 ring-amber-200'  },
  APPROVED:  { label: 'Approved',  classes: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' },
  REJECTED:  { label: 'Rejected',  classes: 'bg-red-50     text-red-700    ring-1 ring-red-200'    },
  CANCELLED: { label: 'Cancelled', classes: 'bg-zinc-100   text-zinc-500   ring-1 ring-zinc-200'   },
};

function StatusPill({ status }: { status: LicenseRequestStatus }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, classes: 'bg-zinc-100 text-zinc-500' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${cfg.classes}`}>
      {cfg.label}
    </span>
  );
}

const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const SHORT_ID = (id: string) => id.slice(0, 8).toUpperCase();

// ─── Detail drawer ────────────────────────────────────────────────────────────

function DetailRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2.5" style={{ borderBottom: '1px solid oklch(0.95 0 0)' }}>
      <Icon className="h-3.5 w-3.5 text-zinc-300 mt-0.5 shrink-0" />
      <span className="text-xs text-zinc-400 w-28 shrink-0">{label}</span>
      <span className="text-xs text-zinc-800 font-medium">{value}</span>
    </div>
  );
}

function RequestDetailDialog({ req, onClose }: { req: LicenseRequest; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold text-zinc-800">
            Request #{SHORT_ID(req.id)}
          </DialogTitle>
          <DialogDescription className="text-xs text-zinc-400">
            Full details for this license request
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2">
          <DetailRow icon={Hash}          label="Request ID"    value={<code className="text-[11px]">{req.id}</code>} />
          <DetailRow icon={CheckCircle}   label="Status"        value={<StatusPill status={req.status} />} />
          <DetailRow icon={Building2}     label="Company"       value={req.company?.name ?? req.companyId} />
          <DetailRow icon={Package}       label="Product"       value={req.entitlement?.product?.name ?? req.entitlementId} />
          <DetailRow icon={Hash}          label="Seats Requested" value={req.quantity.toLocaleString()} />
          <DetailRow icon={User}          label="Requested By"  value={req.requestedBy} />
          <DetailRow icon={Calendar}      label="Requested On"  value={fmtDate(req.createdAt)} />
          {req.reason && (
            <DetailRow icon={MessageSquare} label="Reason" value={<span className="whitespace-pre-wrap">{req.reason}</span>} />
          )}
          {req.reviewedBy && (
            <DetailRow icon={User}        label="Reviewed By"   value={req.reviewedBy} />
          )}
          {req.reviewedAt && (
            <DetailRow icon={Calendar}    label="Reviewed On"   value={fmtDate(req.reviewedAt)} />
          )}
          {req.reviewReason && (
            <DetailRow icon={MessageSquare} label="Review Note"
              value={<span className="whitespace-pre-wrap text-red-700">{req.reviewReason}</span>} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Action dialog ─────────────────────────────────────────────────────────────

function ActionDialog({
  type,
  req,
  onClose,
  onSuccess,
}: {
  type: 'approve' | 'reject';
  req: LicenseRequest;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Only ever set on a successful APPROVE — the two events (request approved,
  // Activation issued) are deliberately shown as two separate facts rather
  // than one collapsed "done" state, since approving is the Customer Admin's
  // action but issuing the Activation is the Trustfabric licensing backend's
  // own decision (see docs/activation-domain.md).
  const [approvalResult, setApprovalResult] = useState<LicenseRequestApproval | null>(null);
  const [copied, setCopied] = useState(false);

  const isApprove = type === 'approve';
  const companyName = req.company?.name ?? req.companyId;
  const productName = req.entitlement?.product?.name ?? req.entitlementId;

  const handleSubmit = async () => {
    if (!isApprove && !reason.trim()) {
      setError('A rejection reason is required.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const result = await apiClient<LicenseRequestApproval>(`/license-requests/${req.id}/${type}`, {
        method: 'POST',
        body:   JSON.stringify({ reason: reason.trim() || undefined }),
      });
      onSuccess();
      if (isApprove) {
        setApprovalResult(result);
      } else {
        onClose();
      }
    } catch (err: any) {
      setError(err instanceof ApiError ? err.message : 'Action failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopyToken = async () => {
    if (!approvalResult?.enrollmentToken) return;
    try {
      await navigator.clipboard.writeText(approvalResult.enrollmentToken.token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable — the token is still selectable/visible in the field.
    }
  };

  // ─── Success state: Request Approved, and — separately — whether the
  // Trustfabric licensing backend issued an Activation as a consequence ───
  if (approvalResult) {
    const employeeName = approvalResult.activation?.user?.name || approvalResult.activation?.user?.email;
    return (
      <Dialog open onOpenChange={onClose}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
              <CheckCircle className="h-4 w-4" />
              Request Approved
            </DialogTitle>
            <DialogDescription className="text-xs text-zinc-400">
              {companyName}'s request for {req.quantity} seat(s) of {productName} is now APPROVED.
            </DialogDescription>
          </DialogHeader>

          {approvalResult.activation ? (
            <div className="mt-1 space-y-3">
              <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-md p-3 text-xs text-blue-800">
                <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  <span className="font-semibold">Activation Issued.</span> The Trustfabric licensing
                  backend has issued the license right for {employeeName ?? 'this employee'} — this is a
                  separate, automatic step, not something you did manually.
                </span>
              </div>

              <dl className="text-xs text-zinc-500 grid grid-cols-2 gap-y-1.5">
                <dt>Activation ID</dt>
                <dd className="text-zinc-800 font-mono">{SHORT_ID(approvalResult.activation.id)}</dd>
                <dt>Status</dt>
                <dd className="text-zinc-800 font-medium">{approvalResult.activation.status}</dd>
                <dt>Employee</dt>
                <dd className="text-zinc-800 font-medium">{employeeName ?? approvalResult.activation.userId}</dd>
              </dl>

              {approvalResult.enrollmentToken && (
                <div className="space-y-2 pt-1">
                  <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-md p-3 text-xs text-amber-800">
                    <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>
                      This enrollment code is shown only this once — copy it now and give it to the
                      employee so their Windows Agent can register. It cannot be retrieved again.
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      readOnly
                      value={approvalResult.enrollmentToken.token}
                      className="font-mono text-xs"
                      onFocus={(e) => e.currentTarget.select()}
                    />
                    <Button type="button" variant="outline" size="icon" onClick={handleCopyToken} title="Copy code">
                      {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-zinc-500 mt-1">
              This was a capacity request with no specific employee named, so no individual Activation
              was issued — the seats were added to {companyName}'s allocation.
            </p>
          )}

          <DialogFooter>
            <Button type="button" onClick={onClose}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // ─── Confirmation form state ───────────────────────────────────────────
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">
            {isApprove ? 'Approve Request' : 'Reject Request'}
          </DialogTitle>
          <DialogDescription className="text-xs text-zinc-400">
            {isApprove
              ? `Approving authorizes ${req.quantity} seat(s) of ${productName} for ${companyName}. Issuing the actual license activation is handled automatically by the Trustfabric licensing backend.`
              : `Rejecting the request for ${req.quantity} seat(s) of ${productName} from ${companyName}.`}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-3 space-y-3">
          {error && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
              {error}
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="action-reason" className="text-xs font-medium text-zinc-600">
              {isApprove ? 'Approval Note (optional)' : 'Rejection Reason (required)'}
            </Label>
            <Textarea
              id="action-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={isApprove ? 'Any note for the audit log…' : 'State why this request is being rejected…'}
              rows={3}
              className="text-sm"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" size="sm" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={submitting || (!isApprove && !reason.trim())}
            variant={isApprove ? 'default' : 'destructive'}
            onClick={handleSubmit}
          >
            {submitting ? 'Processing…' : isApprove ? 'Confirm Approval' : 'Confirm Rejection'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type StatusFilter = 'ALL' | LicenseRequestStatus;

const FILTERS: StatusFilter[] = ['ALL', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'];

export default function LicenseRequestsPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [requests, setRequests] = useState<LicenseRequest[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');

  const [detailReq, setDetailReq]     = useState<LicenseRequest | null>(null);
  const [actionDialog, setActionDialog] = useState<{ type: 'approve' | 'reject'; req: LicenseRequest } | null>(null);

  const canApprove = user.roles.includes('EnterpriseAdmin') || user.roles.includes('CompanyAdmin');
  const isEnterpriseScoped = user.allowedCompanyIds.includes('*');
  // Mirrors LicenseRequestsService.approve()'s multi-tenant rule for UI
  // affordance only — the backend is the actual enforcer. A capacity
  // request (no targetUserId) draws from the shared enterprise entitlement
  // pool, so only an enterprise-scoped admin may approve it; a named
  // request is a company-internal decision, unaffected either way.
  const canApproveRequest = (req: LicenseRequest) => canApprove && (!!req.targetUserId || isEnterpriseScoped);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiClient<LicenseRequest[]>('/license-requests');
      setRequests(res);
    } catch (err: any) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const filtered = statusFilter === 'ALL'
    ? requests
    : requests.filter(r => r.status === statusFilter);

  const countFor = (s: StatusFilter) =>
    s === 'ALL' ? requests.length : requests.filter(r => r.status === s).length;

  // Enterprise-only page — a company-scoped session (a single tenant, not
  // the parent/enterprise level) never sees this at all, not even by direct
  // URL. This is a hard access boundary with no dialogs to protect, so an
  // early return is safe here (unlike the loading/error states below).
  if (!isEnterpriseScoped) {
    return (
      <div>
        <PageHeader
          title="License Requests"
          description="Review and approve seat requests from subsidiaries and departments"
        />
        <EmptyState
          title="Enterprise Admins Only"
          description="License Requests is a parent-company (enterprise) view for granting capacity to your companies. Your account is scoped to a single company and doesn't have access to this page."
        />
      </div>
    );
  }

  // loading/error are rendered inline below rather than as early returns — a
  // background refresh triggered by ActionDialog's onSuccess (after a
  // successful approve) must never unmount ActionDialog while it's showing
  // the Activation-issued/one-time-token success view.
  return (
    <div>
      <PageHeader
        title="License Requests"
        description="Review and approve seat requests from subsidiaries and departments"
        actions={
          <Button variant="outline" size="sm" onClick={loadData}>
            <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
            Refresh
          </Button>
        }
      />

      {loading ? (
        <LoadingState message="Loading license requests…" />
      ) : error ? (
        <ErrorState error={error} onRetry={loadData} />
      ) : (
        <>
      {/* Status filter tabs */}
      <div className="flex gap-1 mb-4 p-1 bg-zinc-100 rounded-lg w-fit">
        {FILTERS.map((f) => {
          const count = countFor(f);
          const active = f === statusFilter;
          return (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1.5 ${
                active
                  ? 'bg-white text-zinc-900 shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-700'
              }`}
            >
              {f === 'ALL' ? 'All' : f.charAt(0) + f.slice(1).toLowerCase()}
              <span className={`text-[10px] tabular-nums ${active ? 'text-zinc-400' : 'text-zinc-400'}`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title={statusFilter === 'ALL' ? 'No Requests Found' : `No ${statusFilter.toLowerCase()} requests`}
          description="There are currently no license requests matching this filter."
          action={<Button variant="outline" size="sm" onClick={loadData}>Refresh</Button>}
        />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr style={{ borderBottom: '1px solid oklch(0.91 0 0)' }}>
                  {['Status', 'Ref', 'Company', 'Product', 'Seats', 'Requested', 'Created', ''].map((h, i) => (
                    <th
                      key={i}
                      className="px-4 py-2.5 text-[11px] font-medium text-zinc-400 uppercase tracking-wide whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((req) => (
                  <tr
                    key={req.id}
                    className="hover:bg-zinc-50/60 transition-colors"
                    style={{ borderBottom: '1px solid oklch(0.95 0 0)' }}
                  >
                    <td className="px-4 py-3">
                      <StatusPill status={req.status} />
                    </td>
                    <td className="px-4 py-3">
                      <code className="text-[11px] text-zinc-500">{SHORT_ID(req.id)}</code>
                    </td>
                    <td className="px-4 py-3 font-medium text-zinc-800">
                      {req.company?.name ?? req.companyId}
                    </td>
                    <td className="px-4 py-3 text-zinc-600">
                      {req.entitlement?.product?.name ?? req.entitlementId}
                    </td>
                    <td className="px-4 py-3 text-zinc-600 tabular-nums">
                      {req.quantity.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-zinc-400 text-xs" title={req.requestedBy}>
                      <div className="flex items-center gap-1">
                        <User className="h-3 w-3" />
                        <span className="max-w-[100px] truncate">{req.requestedBy}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-zinc-400 text-xs whitespace-nowrap">
                      {fmtDate(req.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        {/* Details */}
                        <button
                          onClick={() => setDetailReq(req)}
                          className="h-7 w-7 flex items-center justify-center rounded text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors"
                          title="View details"
                        >
                          <ChevronRight className="h-3.5 w-3.5" />
                        </button>

                        {/* Approve — only for PENDING + authorized, and (for a
                            capacity request with no named employee) only an
                            enterprise-scoped admin */}
                        {req.status === 'PENDING' && canApprove && (
                          <>
                            <button
                              id={`btn-approve-${req.id}`}
                              onClick={() => setActionDialog({ type: 'approve', req })}
                              disabled={!canApproveRequest(req)}
                              title={
                                canApproveRequest(req)
                                  ? 'Approve'
                                  : "Only an enterprise-scoped admin can approve a capacity request — this company's own admin can't approve it for themselves"
                              }
                              className={`h-7 w-7 flex items-center justify-center rounded transition-colors ${
                                canApproveRequest(req)
                                  ? 'text-emerald-500 hover:text-emerald-700 hover:bg-emerald-50'
                                  : 'text-zinc-300 cursor-not-allowed'
                              }`}
                            >
                              <CheckCircle className="h-3.5 w-3.5" />
                            </button>
                            <button
                              id={`btn-reject-${req.id}`}
                              onClick={() => setActionDialog({ type: 'reject', req })}
                              className="h-7 w-7 flex items-center justify-center rounded text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                              title="Reject"
                            >
                              <XCircle className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}

                        {/* Review indicator for non-pending */}
                        {req.status !== 'PENDING' && req.reviewedAt && (
                          <span className="text-[10px] text-zinc-300 whitespace-nowrap">
                            {fmtDate(req.reviewedAt)}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
        </>
      )}

      {/* Modals — deliberately outside the loading/error conditional above,
          so a background refresh (e.g. ActionDialog's onSuccess after a
          successful approve) never unmounts a dialog that's still showing
          its result. */}
      {detailReq && (
        <RequestDetailDialog req={detailReq} onClose={() => setDetailReq(null)} />
      )}
      {actionDialog && (
        <ActionDialog
          type={actionDialog.type}
          req={actionDialog.req}
          onClose={() => setActionDialog(null)}
          onSuccess={loadData}
        />
      )}
    </div>
  );
}
