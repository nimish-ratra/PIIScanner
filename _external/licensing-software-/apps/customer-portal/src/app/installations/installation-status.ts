import type { InstallationStatus } from '@/lib/types';

export const INSTALLATION_STATUS_CONFIG: Record<InstallationStatus, { label: string; classes: string }> = {
  ACTIVE:    { label: 'Active',    classes: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' },
  PENDING:   { label: 'Pending',   classes: 'bg-amber-50   text-amber-700  ring-1 ring-amber-200'   },
  INACTIVE:  { label: 'Inactive',  classes: 'bg-zinc-100   text-zinc-500   ring-1 ring-zinc-200'    },
  SUSPENDED: { label: 'Suspended', classes: 'bg-orange-50  text-orange-700 ring-1 ring-orange-200'  },
  REVOKED:   { label: 'Revoked',   classes: 'bg-red-50     text-red-700    ring-1 ring-red-200'     },
};

/** Legal admin-driven transitions — mirrors InstallationsService.VALID_TRANSITIONS exactly, for UI affordance only. The backend is the actual enforcer. */
export const INSTALLATION_VALID_TRANSITIONS: Record<InstallationStatus, InstallationStatus[]> = {
  PENDING: ['ACTIVE', 'REVOKED'],
  ACTIVE: ['SUSPENDED', 'REVOKED'],
  INACTIVE: ['SUSPENDED', 'REVOKED'],
  SUSPENDED: ['ACTIVE', 'REVOKED'],
  REVOKED: [],
};
