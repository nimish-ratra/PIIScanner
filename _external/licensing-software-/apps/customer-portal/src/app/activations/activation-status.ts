import type { ActivationStatus } from '@/lib/types';

export const ACTIVATION_STATUS_CONFIG: Record<ActivationStatus, { label: string; classes: string }> = {
  PENDING:     { label: 'Pending',     classes: 'bg-amber-50   text-amber-700  ring-1 ring-amber-200'  },
  ACTIVE:      { label: 'Active',      classes: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' },
  SUSPENDED:   { label: 'Suspended',   classes: 'bg-orange-50  text-orange-700 ring-1 ring-orange-200'  },
  DEACTIVATED: { label: 'Deactivated', classes: 'bg-blue-50    text-blue-700   ring-1 ring-blue-200'    },
  REVOKED:     { label: 'Revoked',     classes: 'bg-red-50     text-red-700    ring-1 ring-red-200'     },
  EXPIRED:     { label: 'Expired',     classes: 'bg-zinc-100   text-zinc-500   ring-1 ring-zinc-200'    },
};

/**
 * Mirrors ActivationsService's VALID_TRANSITIONS exactly, for UI affordance
 * only — the backend is the actual enforcer. Only PENDING->ACTIVE (the
 * agent's own registration, never customer-initiated) and the terminal
 * states are excluded from what the Customer Portal exposes as buttons:
 * a Customer Admin can suspend/reactivate/revoke a live Activation, and can
 * request a replacement enrollment for a DEACTIVATED one (device
 * replacement), but never manually "activates" anything — see
 * docs/activation-domain.md.
 */
export const ACTIVATION_VALID_TRANSITIONS: Record<ActivationStatus, ActivationStatus[]> = {
  PENDING: ['ACTIVE', 'REVOKED'],
  ACTIVE: ['SUSPENDED', 'DEACTIVATED', 'REVOKED', 'EXPIRED'],
  SUSPENDED: ['ACTIVE', 'REVOKED', 'DEACTIVATED'],
  DEACTIVATED: ['ACTIVE', 'REVOKED'],
  REVOKED: [],
  EXPIRED: [],
};
