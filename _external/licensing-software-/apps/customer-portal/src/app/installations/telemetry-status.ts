import { TelemetryDerivedStatus } from '@/lib/types';

export const TELEMETRY_STATUS_CONFIG: Record<
  TelemetryDerivedStatus,
  { label: string; description: string; classes: string; dotClass: string }
> = {
  LIVE: {
    label: 'Live',
    description: 'Reporting active telemetry within expected interval and service is running',
    classes: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
    dotClass: 'bg-emerald-500',
  },
  STALE: {
    label: 'Stale',
    description: 'Last ping received within 30 minutes, awaiting next scheduled ping',
    classes: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
    dotClass: 'bg-amber-500',
  },
  STOPPED: {
    label: 'Service Stopped',
    description: 'Agent service explicitly reported stopped state',
    classes: 'bg-red-50 text-red-700 ring-1 ring-red-200',
    dotClass: 'bg-red-500',
  },
  OFFLINE: {
    label: 'Offline',
    description: 'No telemetry received for over 30 minutes',
    classes: 'bg-zinc-100 text-zinc-600 ring-1 ring-zinc-200',
    dotClass: 'bg-zinc-400',
  },
  NO_DATA: {
    label: 'No Telemetry',
    description: 'Installation has never connected to fleet telemetry service',
    classes: 'bg-slate-50 text-slate-500 ring-1 ring-slate-200',
    dotClass: 'bg-slate-400',
  },
  DISABLED: {
    label: 'Disabled',
    description: 'Fleet telemetry reporting is disabled by organization policy',
    classes: 'bg-zinc-50 text-zinc-400 ring-1 ring-zinc-200',
    dotClass: 'bg-zinc-300',
  },
};
