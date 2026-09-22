'use client';

import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Installation } from '@/lib/types';
import { Hash, Monitor, Building2, Package, Cpu, Activity, Calendar } from 'lucide-react';
import { INSTALLATION_STATUS_CONFIG } from './installation-status';

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

/**
 * Vendor-side read-only detail view. The vendor API (VendorInstallationsController)
 * only exposes GET routes — there is no suspend/unsuspend/revoke here. That is
 * intentional tenant separation: the vendor portal provides global visibility,
 * not customer-level control over an individual company's installations.
 */
export function InstallationDetailsDialog({
  installation,
  onClose,
}: {
  installation: Installation;
  onClose: () => void;
}) {
  const statusCfg = INSTALLATION_STATUS_CONFIG[installation.status] ?? { label: installation.status, classes: '' };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold text-zinc-800 flex items-center gap-2">
            <Monitor className="h-4 w-4 text-zinc-400" />
            {installation.hostname || 'Unnamed device'}
          </DialogTitle>
          <DialogDescription className="text-xs text-zinc-400">
            Global installation record (read-only — vendor scope)
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[65vh] overflow-y-auto pr-1">
          <SectionLabel>Identity</SectionLabel>
          <DetailRow icon={Hash} label="Installation ID" value={<code className="text-[11px]">{installation.id}</code>} />
          <DetailRow icon={Cpu} label="Device ID" value={<code className="text-[11px]">{installation.deviceId}</code>} />
          <DetailRow icon={Monitor} label="Hostname" value={installation.hostname || '—'} />

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

          <SectionLabel>Telemetry</SectionLabel>
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
      </DialogContent>
    </Dialog>
  );
}
