/**
 * Shared credential hashing helpers for the Agent Protocol.
 *
 * Both enrollment tokens and per-installation agent secrets follow the same
 * pattern: a random opaque value is generated, shown to the caller exactly
 * once, and only its sha256 hash is ever persisted. Nothing that could
 * re-derive the plaintext is stored server-side.
 */

import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

export function generateSecret(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export function safeCompareHash(providedSecret: string, storedHash: string): boolean {
  const providedHash = hashSecret(providedSecret);
  const a = Buffer.from(providedHash, 'hex');
  const b = Buffer.from(storedHash, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
