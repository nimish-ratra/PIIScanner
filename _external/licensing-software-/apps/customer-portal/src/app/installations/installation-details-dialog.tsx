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
import { Installation, InstallationStatus } from '@/lib/types';
import {
  Hash, Monitor, Building2, Package, Cpu, Activity, Calendar,
  PauseCircle, PlayCircle, Ban, User, Mail, CheckCircle2, XCircle, ShieldCheck
} from 'lucide-react';
import { INSTALLATION_STATUS_CONFIG, INSTALLATION_VALID_TRANSITIONS } from './installation-status';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { InstallationProtectionTab } from './installation-protection-tab';

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

type ConfirmAction = 'suspend' | 'unsuspend' | 'revoke' | 'approve' | 'reject';

// 'reject' has its own confirmation copy but hits the same endpoint as
// 'revoke' — both are just PENDING/ACTIVE -> REVOKED to the backend, which
// picks the audit label (APPROVE_INSTALLATION/REJECT_INSTALLATION vs the
// generic ones) based on the installation's prior status either way.
const ENDPOINT_FOR_ACTION: Record<ConfirmAction, string> = {
  suspend: 'suspend',
  unsuspend: 'unsuspend',
  revoke: 'revoke',
  approve: 'approve',
  reject: 'revoke',
};

interface InstallationDetailsDialogProps {
  installation: Installation;
  canManage: boolean;
  defaultTab?: 'identity' | 'protection';
  onClose: () => void;
  onChanged: () => void;
}

export function InstallationDetailsDialog({
  installation,
  canManage,
  defaultTab = 'identity',
  onClose,
  onChanged,
}: InstallationDetailsDialogProps) {
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const status = installation.status;
  const statusCfg = INSTALLATION_STATUS_CONFIG[status];
  const allowedTransitions = INSTALLATION_VALID_TRANSITIONS[status] ?? [];

  const runAction = async (action: ConfirmAction) => {
    setSubmitting(true);
    setError(null);
    try {
      await apiClient(`/installations/${installation.id}/${ENDPOINT_FOR_ACTION[action]}`, { method: 'POST' });
      // Close entirely rather than reopening the detail view with a now-stale
      // `installation` prop — the parent refetches and the list re-renders fresh.
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
      title: 'Suspend Installation?',
      description: 'The agent will be told to stop functioning on its next check-in. The seat remains allocated — this does not free it up.',
      confirmLabel: 'Suspend',
      variant: 'default',
    },
    unsuspend: {
      title: 'Unsuspend Installation?',
      description: 'The agent will resume normal operation on its next check-in.',
      confirmLabel: 'Unsuspend',
      variant: 'default',
    },
    revoke: {
      title: 'Revoke Installation?',
      description: 'This permanently ends this installation and frees its seat back to the allocation. This cannot be undone — the device would need to be re-enrolled with a new token.',
      confirmLabel: 'Revoke Installation',
      variant: 'destructive',
    },
    approve: {
      title: 'Approve This Registration?',
      description: `This grants ${installation.employeeName || 'this device'} access on their next check-in. The seat was already reserved when they registered.`,
      confirmLabel: 'Approve',
      variant: 'default',
    },
    reject: {
      title: 'Reject This Registration?',
      description: 'This frees the reserved seat back to the allocation. The device would need a fresh enrollment token to try again — this cannot be undone.',
      confirmLabel: 'Reject',
      variant: 'destructive',
    },
  };

  return (
    <>
      <Dialog open={!confirmAction} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="sm:max-w-[660px]">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold text-zinc-800 flex items-center gap-2">
              <Monitor className="h-4 w-4 text-zinc-400" />
              {installation.hostname || 'Unnamed device'}
            </DialogTitle>
            <DialogDescription className="text-xs text-zinc-400">
              Installation records, license lifecycle, and operational fleet protection telemetry
            </DialogDescription>
          </DialogHeader>

          <Tabs defaultValue={defaultTab} className="w-full">
            <TabsList className="grid w-full grid-cols-2 mb-2">
              <TabsTrigger value="identity">Identity & License</TabsTrigger>
              <TabsTrigger value="protection" className="flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5" />
                Protection & Fleet
              </TabsTrigger>
            </TabsList>

            <TabsContent value="identity">
              <div className="max-h-[60vh] overflow-y-auto pr-1">
                <SectionLabel>Identity</SectionLabel>
                <DetailRow icon={Hash} label="Installation ID" value={<code className="text-[11px]">{installation.id}</code>} />
                <DetailRow icon={Cpu} label="Device ID" value={<code className="text-[11px]">{installation.deviceId}</code>} />
                <DetailRow icon={Monitor} label="Hostname" value={installation.hostname || '—'} />

                {(installation.employeeName || installation.employeeEmail) && (
                  <>
                    <SectionLabel>Requested By</SectionLabel>
                    <DetailRow icon={User} label="Name" value={installation.employeeName || '—'} />
                    <DetailRow icon={Mail} label="Email" value={installation.employeeEmail || '—'} />
                  </>
                )}

                <SectionLabel>Ownership</SectionLabel>
                <DetailRow icon={Building2} label="Company" value={installation.company?.name ?? installation.companyId} />
                <DetailRow icon={Package} label="Allocation" value={<code className="text-[11px]">{installation.allocationId}</code>} />

                <SectionLabel>Status</SectionLabel>
                <DetailRow
                  icon={Activity}
                  label="Current Status"
                  value={
                    <Badge variant="outline" className={statusCfg.classes}>
                      {statusCfg.label}
                    </Badge>
                  }
                />

                <SectionLabel>Licensing Heartbeat</SectionLabel>
                <DetailRow icon={Activity} label="Last Heartbeat" value={fmtDateTime(installation.lastHeartbeatAt)} />
                <DetailRow icon={Cpu} label="OS" value={[installation.os, installation.osVersion].filter(Boolean).join(' ') || '—'} />
                <DetailRow icon={Cpu} label="Architecture" value={installation.architecture || '—'} />
                <DetailRow icon={Package} label="Application Version" value={installation.applicationVersion || '—'} />
                <DetailRow icon={Package} label="Agent Version" value={installation.agentVersion || '—'} />

                <SectionLabel>Lifecycle</SectionLabel>
                <DetailRow icon={Calendar} label="Registered" value={fmtDateTime(installation.createdAt)} />
                <DetailRow icon={Calendar} label="Last Updated" value={fmtDateTime(installation.updatedAt)} />
                {installation.releasedAt && (
                  <DetailRow icon={Calendar} label="Released / Revoked" value={fmtDateTime(installation.releasedAt)} />
                )}
              </div>
            </TabsContent>

            <TabsContent value="protection">
              <div className="max-h-[60vh] overflow-y-auto pr-1">
                <InstallationProtectionTab installationId={installation.id} canManage={canManage} />
              </div>
            </TabsContent>
          </Tabs>

          {error && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
              {error}
            </div>
          )}

          {canManage && status === 'PENDING' && (
            <DialogFooter className="!justify-between sm:!justify-between">
              <div />
              <div className="flex gap-2">
                <Button variant="destructive" size="sm" onClick={() => setConfirmAction('reject')} disabled={submitting}>
                  <XCircle className="h-3.5 w-3.5" />
                  Reject
                </Button>
                <Button size="sm" onClick={() => setConfirmAction('approve')} disabled={submitting}>
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Approve
                </Button>
              </div>
            </DialogFooter>
          )}

          {canManage && status !== 'PENDING' && allowedTransitions.length > 0 && (
            <DialogFooter className="!justify-between sm:!justify-between">
              <div />
              <div className="flex gap-2">
                {allowedTransitions.includes('SUSPENDED') && (
                  <Button variant="outline" size="sm" onClick={() => setConfirmAction('suspend')} disabled={submitting}>
                    <PauseCircle className="h-3.5 w-3.5" />
                    Suspend
                  </Button>
                )}
                {status === 'SUSPENDED' && allowedTransitions.includes('ACTIVE') && (
                  <Button variant="outline" size="sm" onClick={() => setConfirmAction('unsuspend')} disabled={submitting}>
                    <PlayCircle className="h-3.5 w-3.5" />
                    Unsuspend
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
                <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
                  {error}
                </div>
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
