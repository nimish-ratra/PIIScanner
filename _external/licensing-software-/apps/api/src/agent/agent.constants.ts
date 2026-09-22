/**
 * Tunables for the hybrid online/offline Agent Protocol.
 *
 * The agent is expected to heartbeat roughly once per interval. If it can't
 * reach the backend (offline/air-gapped site), it keeps working using the
 * last policy it fetched until the grace period elapses, at which point it
 * must re-sync before continuing to enforce entitlement.
 */
export const HEARTBEAT_INTERVAL_SECONDS = 24 * 60 * 60; // 24 hours
export const GRACE_PERIOD_DAYS = 14; // enforced client-side by the agent using its cached policy
export const DEFAULT_ENROLLMENT_TOKEN_TTL_DAYS = 30;
export const DEFAULT_ENROLLMENT_TOKEN_MAX_ACTIVATIONS = 1;
