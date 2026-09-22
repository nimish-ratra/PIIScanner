/**
 * AuthGuard
 *
 * Resolves the authenticated principal for every incoming request.
 *
 * Supported AUTH_MODE values:
 *   password — Production. Reads the iron-session cookie — TF_SESSION for
 *              Customer Portal (POST /customer/auth/login) or
 *              TF_VENDOR_SESSION for Trustfabric Admin
 *              (POST /vendor/auth/login), picked by URL prefix — loads
 *              principal from DB.
 *   e2e      — Test only. Reads E2E_SESSION cookie (base64 JSON). BLOCKED in production.
 *
 * OIDC/SSO and the mock Bearer token auth path have both been fully removed —
 * Customer Admin and Trustfabric Admin login are both Trustfabric-managed
 * email/password only. Agent authentication is a separate system and is
 * unaffected.
 *
 * After this guard runs, request.user is a ResolvedPrincipal with roles,
 * permissions, and allowedCompanyIds loaded fresh from the database.
 * Nothing from the session cookie directly becomes an authorization decision.
 */

import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './public.decorator.js';
import { SessionService } from './session.service.js';
import { IdentityService } from './identity.service.js';

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly sessionService: SessionService,
    private readonly identityService: IdentityService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    const authMode = process.env.AUTH_MODE;
    const isDevOrTest = process.env.NODE_ENV !== 'production';

    // In dev/test, if E2E_SESSION cookie is present, allow it to override the session check
    if (isDevOrTest && request.cookies?.['E2E_SESSION']) {
      return this.handleE2eAuth(request);
    }

    // In dev/test, if password session cookie is present, handle session auth seamlessly
    if (isDevOrTest && (request.cookies?.[this.sessionService.customerCookieName] || request.cookies?.[this.sessionService.vendorCookieName])) {
      return this.handleSessionAuth(request, response);
    }

    if (authMode === 'e2e') {
      return this.handleE2eAuth(request);
    }

    if (authMode === 'password') {
      return this.handleSessionAuth(request, response);
    }

    // Reject any unrecognized AUTH_MODE rather than fall through silently
    throw new UnauthorizedException(
      `Unsupported AUTH_MODE "${authMode ?? 'unset'}". Expected "password" or "e2e".`,
    );
  }

  /**
   * E2E authentication — test-only.
   * Reads a base64-encoded JSON principal from the E2E_SESSION cookie.
   * Never loads from DB — intentional for test isolation.
   */
  private handleE2eAuth(request: any): boolean {
    const e2eSession = request.cookies?.['E2E_SESSION'];
    if (!e2eSession) {
      throw new UnauthorizedException('E2E Auth: Missing session cookie');
    }
    try {
      const decoded = Buffer.from(e2eSession, 'base64').toString('utf-8');
      const parsed = JSON.parse(decoded);
      // Wrap in the expected principal shape (permissions as Set)
      request.user = {
        ...parsed,
        permissions: new Set<string>(this.deriveE2ePermissions(parsed.roles ?? [])),
      };
      return true;
    } catch {
      throw new UnauthorizedException('E2E Auth: Invalid session cookie');
    }
  }

  /**
   * Derive permissions from roles for E2E test principals.
   * Mirrors the role assignments seeded in seed-e2e.ts.
   * This is ONLY used in e2e mode.
   */
  private deriveE2ePermissions(roles: string[]): string[] {
    if (roles.includes('TrustfabricAdmin') || roles.includes('EnterpriseAdmin')) {
      return ['*'];
    }
    if (roles.includes('CompanyAdmin')) {
      return [
        'company.read', 'company.manage',
        'user.read', 'user.manage',
        'entitlement.read',
        'license.read', 'license.allocate', 'license.suspend', 'license.revoke',
        'installation.read', 'installation.manage', 'installation.enroll',
        'license_request.read', 'license_request.create',
        'license_request.approve', 'license_request.reject', 'license_request.cancel',
        'activation.read', 'activation.manage',
        'audit.read',
      ];
    }
    if (roles.includes('LicenseManager')) {
      return ['license.read', 'license.allocate', 'license.suspend', 'license_request.read', 'license_request.approve'];
    }
    if (roles.includes('Auditor')) {
      return ['audit.read'];
    }
    return ['license.read'];
  }

  /**
   * Password-login / production authentication.
   * Unseals the iron-session cookie (set by CustomerAuthService.login or
   * VendorAuthService.login via SessionService.createSession) → loads
   * principal fresh from DB. Touches the session to extend the idle timeout.
   *
   * Customer and Vendor sessions use different cookie names (see
   * SessionService) and resolve through different tables — which one to use
   * is picked from the URL prefix, the same signal PermissionsGuard already
   * uses to enforce principal-type isolation.
   */
  private async handleSessionAuth(request: any, response: any): Promise<boolean> {
    // Exact path-segment match, not a substring match and not a fixed index —
    // see PermissionsGuard for why a naive `.includes('/vendor')` is unsafe
    // once a vendor resource name can itself contain "vendor" or "customer"
    // as a substring (e.g. "/vendor/customers"), and why a fixed index isn't
    // safe either (Express strips the "api/v1" global prefix from
    // request.url by the time it reaches this guard).
    const segments = (request.url ?? '').split('?')[0].split('/').filter(Boolean);
    const isVendorRoute: boolean = segments.includes('vendor');
    const cookieName = isVendorRoute ? this.sessionService.vendorCookieName : this.sessionService.customerCookieName;

    const sessionPayload = await this.sessionService.readSession(request, cookieName);
    if (!sessionPayload) {
      throw new UnauthorizedException('Session not found or expired');
    }

    try {
      const principal = isVendorRoute
        ? await this.identityService.resolveVendorPrincipalById(sessionPayload.userId)
        : await this.identityService.resolvePrincipalById(sessionPayload.userId);
      request.user = principal;

      // Touch the session to keep the idle timeout alive (fire-and-forget)
      this.sessionService.touchSession(request, response, cookieName).catch((err: unknown) => {
        this.logger.error('Failed to touch session', err);
      });

      return true;
    } catch (err) {
      if (err instanceof ForbiddenException) throw err;
      this.logger.warn(`Principal resolution failed for userId=${sessionPayload.userId}: ${(err as Error).message}`);
      throw new UnauthorizedException('Could not resolve authenticated principal');
    }
  }
}
