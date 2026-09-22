'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/state';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { apiClient, ApiError } from '@/lib/api-client';
import { Company, EnrollmentToken, LicenseAllocation } from '@/lib/types';
import { KeyRound, Plus } from 'lucide-react';
import { CreateEnrollmentTokenDialog } from './create-enrollment-token-dialog';

interface EnrollmentTokenRow extends EnrollmentToken {
  companyName?: string;
}

function tokenStatus(token: EnrollmentToken): { label: string; classes: string } {
  if (token.revokedAt) return { label: 'Revoked', classes: 'bg-zinc-100 text-zinc-500 ring-1 ring-zinc-200' };
  if (new Date(token.expiresAt).getTime() < Date.now())
    return { label: 'Expired', classes: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200' };
  if (token.activationsUsed >= token.maxActivations)
    return { label: 'Exhausted', classes: 'bg-zinc-100 text-zinc-500 ring-1 ring-zinc-200' };
  return { label: 'Active', classes: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' };
}

interface EnrollmentTokensPanelProps {
  companies: Company[];
  allocations: LicenseAllocation[];
  /** '*' means "all companies in scope" — fetch tokens per company and merge. */
  scopeCompanyId: string;
  canManage: boolean;
  /** Set right after a batch is allocated on the parent page — auto-opens the
   * generate dialog pre-scoped to it, defaulted to bulk/CSV mode. */
  pendingAllocation?: LicenseAllocation | null;
  onPendingAllocationHandled?: () => void;
}

export function EnrollmentTokensPanel({
  companies,
  allocations,
  scopeCompanyId,
  canManage,
  pendingAllocation,
  onPendingAllocationHandled,
}: EnrollmentTokensPanelProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [tokens, setTokens] = useState<EnrollmentTokenRow[]>([]);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    if (pendingAllocation) {
      setCreateOpen(true);
    }
  }, [pendingAllocation]);
  const [revokeTarget, setRevokeTarget] = useState<EnrollmentTokenRow | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const companiesInScope =
    scopeCompanyId === '*' ? companies : companies.filter((c) => c.id === scopeCompanyId);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const results = await Promise.all(
        companiesInScope.map((c) =>
          apiClient<EnrollmentToken[]>(`/companies/${c.id}/enrollment-tokens`)
            .then((rows) => rows.map((t) => ({ ...t, companyName: c.name })))
            .catch(() => [] as EnrollmentTokenRow[]),
        ),
      );

      setTokens(results.flat().sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    } catch (err: any) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [scopeCompanyId, companies.length]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRevoke = async () => {
    if (!revokeTarget) return;
    setRevoking(true);
    setRevokeError(null);
    try {
      await apiClient(`/companies/${revokeTarget.companyId}/enrollment-tokens/${revokeTarget.id}/revoke`, {
        method: 'POST',
      });
      setRevokeTarget(null);
      await loadData();
    } catch (err: any) {
      setRevokeError(err instanceof ApiError ? err.message : 'Failed to revoke token.');
    } finally {
      setRevoking(false);
    }
  };

  // Loading/error are rendered inline below rather than as early returns —
  // a background refresh (e.g. right after creating a token) must never
  // unmount CreateEnrollmentTokenDialog while it's showing a one-time secret.
  return (
    <div>
      <div className="flex justify-end mb-4">
        {canManage && (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            Generate Token
          </Button>
        )}
      </div>

      {loading ? (
        <LoadingState message="Loading enrollment tokens..." />
      ) : error ? (
        <ErrorState error={error} onRetry={loadData} />
      ) : tokens.length === 0 ? (
        <EmptyState
          title="No Enrollment Tokens"
          description="Generate a token to let a device register itself and consume a seat from an allocation."
          action={
            canManage ? (
              <Button variant="outline" onClick={() => setCreateOpen(true)}>
                Generate Token
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="rounded-md border bg-white shadow-sm overflow-x-auto">
          <Table>
            <TableHeader className="bg-slate-50">
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>Label</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Activations</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Created</TableHead>
                {canManage && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {tokens.map((token) => {
                const status = tokenStatus(token);
                const isRevocable = status.label === 'Active';
                return (
                  <TableRow key={token.id}>
                    <TableCell>
                      <Badge variant="outline" className={status.classes}>
                        {status.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium flex items-center gap-2">
                      <KeyRound className="h-3.5 w-3.5 text-slate-400" />
                      {token.label || <span className="text-slate-400 italic">Untitled</span>}
                    </TableCell>
                    <TableCell>{token.companyName || token.companyId}</TableCell>
                    <TableCell>
                      {token.activationsUsed} / {token.maxActivations}
                    </TableCell>
                    <TableCell className="text-slate-500 text-sm">
                      {new Date(token.expiresAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-slate-500 text-sm">
                      {new Date(token.createdAt).toLocaleDateString()}
                    </TableCell>
                    {canManage && (
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8"
                          disabled={!isRevocable}
                          onClick={() => setRevokeTarget(token)}
                        >
                          Revoke
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {canManage && (
        <CreateEnrollmentTokenDialog
          isOpen={createOpen}
          onOpenChange={(open) => {
            setCreateOpen(open);
            if (!open) onPendingAllocationHandled?.();
          }}
          companies={companiesInScope}
          allocations={allocations}
          tokens={tokens}
          defaultCompanyId={scopeCompanyId}
          defaultAllocationId={pendingAllocation?.id}
          defaultMode={pendingAllocation ? 'bulk' : undefined}
          onSuccess={loadData}
        />
      )}

      <Dialog open={!!revokeTarget} onOpenChange={(open) => !open && !revoking && setRevokeTarget(null)}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Revoke Enrollment Token?</DialogTitle>
            <DialogDescription>
              {revokeTarget && (
                <>
                  This immediately prevents{' '}
                  <span className="font-medium text-slate-700">
                    {revokeTarget.label || 'this token'}
                  </span>{' '}
                  from being redeemed again. Devices already registered with it are not affected.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          {revokeError && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
              {revokeError}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokeTarget(null)} disabled={revoking}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleRevoke} disabled={revoking}>
              {revoking ? 'Revoking...' : 'Revoke Token'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
