export type AllocationStatus = 'CREATED' | 'ALLOCATED' | 'ACTIVE' | 'SUSPENDED' | 'REVOKED' | 'EXPIRED';

export const ALLOCATION_STATUS_CONFIG: Record<AllocationStatus, { label: string; classes: string }> = {
  CREATED:   { label: 'Created',   classes: 'bg-zinc-100   text-zinc-500   ring-1 ring-zinc-200'   },
  ALLOCATED: { label: 'Allocated', classes: 'bg-blue-50    text-blue-700   ring-1 ring-blue-200'    },
  ACTIVE:    { label: 'Active',    classes: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' },
  SUSPENDED: { label: 'Suspended', classes: 'bg-orange-50  text-orange-700 ring-1 ring-orange-200'  },
  REVOKED:   { label: 'Revoked',   classes: 'bg-red-50     text-red-700    ring-1 ring-red-200'     },
  EXPIRED:   { label: 'Expired',   classes: 'bg-zinc-100   text-zinc-500   ring-1 ring-zinc-200'    },
};

/** Mirrors LicensesService.VALID_TRANSITIONS exactly, for UI affordance only — the backend is the actual enforcer. */
export const ALLOCATION_VALID_TRANSITIONS: Record<AllocationStatus, AllocationStatus[]> = {
  CREATED: ['ALLOCATED'],
  ALLOCATED: ['ACTIVE', 'SUSPENDED', 'REVOKED'],
  ACTIVE: ['SUSPENDED', 'REVOKED', 'EXPIRED'],
  SUSPENDED: ['ACTIVE', 'REVOKED'],
  REVOKED: [],
  EXPIRED: [],
};
