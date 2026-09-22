/**
 * LoginRateLimiterService
 *
 * Minimal in-memory brute-force protection for the customer login endpoint.
 * No existing rate-limit infrastructure exists in this repo (no Redis client
 * is actually wired up despite REDIS_URL being configured — see
 * docs/architecture.md's "future" note), so a dependency-free in-memory
 * limiter is the appropriate minimum here rather than introducing a new
 * package or standing up Redis for one endpoint.
 *
 * Keyed by IP + normalized email so a single attacker can't work around the
 * limit by rotating emails against one IP, or hammer one account from many
 * IPs without eventually tripping the IP-only bucket too. Fixed window,
 * cleared lazily — acceptable for a single-instance deployment; a
 * multi-instance production deployment should move this to Redis (the
 * interface below is intentionally narrow enough to swap the storage without
 * touching call sites).
 */

import { Injectable } from '@nestjs/common';

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS_PER_KEY = 5;

interface Bucket {
  count: number;
  windowStart: number;
}

@Injectable()
export class LoginRateLimiterService {
  private readonly buckets = new Map<string, Bucket>();

  /** Returns true if this key has exceeded the attempt budget for the current window. */
  isBlocked(key: string): boolean {
    const bucket = this.buckets.get(key);
    if (!bucket) return false;
    if (Date.now() - bucket.windowStart > WINDOW_MS) {
      this.buckets.delete(key);
      return false;
    }
    return bucket.count >= MAX_ATTEMPTS_PER_KEY;
  }

  /** Records a failed attempt against this key. */
  recordFailure(key: string): void {
    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (!bucket || now - bucket.windowStart > WINDOW_MS) {
      this.buckets.set(key, { count: 1, windowStart: now });
      return;
    }
    bucket.count += 1;
  }

  /** Clears any recorded attempts for this key (called on successful login). */
  reset(key: string): void {
    this.buckets.delete(key);
  }

  static keyFor(ip: string, email: string): string {
    return `${ip}:${email.trim().toLowerCase()}`;
  }
}
