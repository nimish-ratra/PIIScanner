/**
 * SessionService
 *
 * Seals and unseals the application session cookie using iron-session v9.
 *
 * Minimal session payload — authorization state (roles, permissions,
 * allowedCompanyIds) is NEVER stored in the cookie. It is resolved fresh from
 * the database on every authenticated request by AuthGuard + IdentityService.
 *
 * This prevents stale authorization data surviving role/permission changes.
 *
 * Customer and Vendor sessions use DIFFERENT cookie names (see
 * `customerCookieName`/`vendorCookieName`) even though both are served by
 * this same API origin. Without that split, a browser that's ever logged
 * into both the Customer Portal and Trustfabric Admin would have one
 * session silently clobber the other, since cookies are scoped by
 * (domain, path), not by which frontend made the request.
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { sealData, unsealData } from 'iron-session';
import type { Response, Request } from 'express';

/** The minimal set of data stored inside the sealed session cookie. */
export interface SessionPayload {
  /** Local User primary key */
  userId: string;
  /** OIDC provider identifier used at login ("entra", "okta", "e2e") */
  provider: string;
  /** Epoch seconds — when the session was created. Used for absolute TTL. */
  createdAt: number;
  /** Epoch seconds — last seen. Used for idle TTL enforcement. */
  lastSeenAt: number;
}

const ABSOLUTE_TTL_SECONDS = 8 * 60 * 60;  // 8 hours
const IDLE_TTL_SECONDS     = 60 * 60;       // 1 hour

@Injectable()
export class SessionService implements OnModuleInit {
  private readonly logger = new Logger(SessionService.name);
  private password!: string;
  private isProduction!: boolean;

  /** Cookie name for Customer Portal sessions (set by POST /customer/auth/login). */
  public customerCookieName!: string;
  /** Cookie name for Trustfabric Admin sessions (set by POST /vendor/auth/login). */
  public vendorCookieName!: string;

  onModuleInit() {
    const secret = process.env.SESSION_SECRET;
    if (!secret || secret.length < 32) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('FATAL: SESSION_SECRET must be at least 32 characters in production');
      }
      this.logger.warn('SESSION_SECRET not set or too short — using insecure dev default. Set SESSION_SECRET in production!');
    }
    this.password      = secret ?? 'dev-insecure-session-secret-change-me-32ch';
    this.customerCookieName = process.env.SESSION_COOKIE_NAME ?? 'TF_SESSION';
    this.vendorCookieName   = process.env.VENDOR_SESSION_COOKIE_NAME ?? 'TF_VENDOR_SESSION';
    this.isProduction  = process.env.NODE_ENV === 'production';
  }

  async createSession(
    res: Response,
    payload: Omit<SessionPayload, 'createdAt' | 'lastSeenAt'>,
    cookieName: string = this.customerCookieName,
  ): Promise<void> {
    const now = Date.now();
    const data: SessionPayload = {
      ...payload,
      createdAt: now,
      lastSeenAt: now,
    };
    const sealed = await sealData(data, { password: this.password, ttl: ABSOLUTE_TTL_SECONDS });
    this.setCookie(res, cookieName, sealed);
  }

  async readSession(req: Request, cookieName: string = this.customerCookieName): Promise<SessionPayload | null> {
    const raw = req.cookies?.[cookieName];
    if (!raw) return null;

    let payload: Partial<SessionPayload>;
    try {
      payload = await unsealData<Partial<SessionPayload>>(raw, {
        password: this.password,
        ttl: ABSOLUTE_TTL_SECONDS,
      });
    } catch {
      this.logger.warn('Failed to unseal session cookie — may be expired or tampered');
      return null;
    }

    if (!payload.userId || !payload.provider || !payload.createdAt || !payload.lastSeenAt) {
      return null;
    }

    // Enforce idle timeout
    const idleMs = Date.now() - payload.lastSeenAt;
    if (idleMs > IDLE_TTL_SECONDS * 1000) {
      this.logger.debug(`Session idle timeout exceeded for user ${payload.userId}`);
      return null;
    }

    return payload as SessionPayload;
  }

  /**
   * Refresh the lastSeenAt timestamp in the session cookie.
   * Call this on every authenticated request to keep the idle timer alive.
   */
  async touchSession(req: Request, res: Response, cookieName: string = this.customerCookieName): Promise<void> {
    const payload = await this.readSession(req, cookieName);
    if (!payload) return;

    payload.lastSeenAt = Date.now();
    const sealed = await sealData(payload, { password: this.password, ttl: ABSOLUTE_TTL_SECONDS });
    this.setCookie(res, cookieName, sealed);
  }

  destroySession(res: Response, cookieName: string = this.customerCookieName): void {
    res.clearCookie(cookieName, { path: '/' });
  }

  private setCookie(res: Response, cookieName: string, sealed: string): void {
    res.cookie(cookieName, sealed, {
      httpOnly: true,
      secure: this.isProduction,
      sameSite: 'lax',
      maxAge: ABSOLUTE_TTL_SECONDS * 1000,
      path: '/',
    });
  }
}
