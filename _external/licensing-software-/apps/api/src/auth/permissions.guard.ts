/**
 * PermissionsGuard
 *
 * Checks that the resolved principal (populated by AuthGuard + IdentityService)
 * holds all permissions required by the @RequirePermissions decorator.
 *
 * Permissions are loaded fresh from the database per-request by IdentityService.
 * The guard itself does NO database lookups — it reads request.user.permissions
 * which is a Set<string> hydrated by AuthGuard.
 *
 * Vendor / Customer principal isolation is enforced here based on the URL prefix.
 */

import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from './permissions.decorator.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !user.principalType) {
      throw new ForbiddenException('Authenticated principal missing');
    }

    // Principal type isolation — customer principals cannot access vendor routes and vice versa.
    // Checked against exact path segments, not a raw substring match —
    // `url.includes('/customer')` would otherwise also match a route like
    // "/vendor/customers" (it legitimately contains "/customer" as a
    // substring of "customers"), incorrectly blocking a vendor resource
    // whose name happens to start with "customer". A fixed segment INDEX
    // isn't safe either — Express strips the "api/v1" global prefix from
    // request.url by the time it reaches this guard, so the position of
    // "vendor"/"customer" in the path isn't stable; exact-match against the
    // whole segment array is.
    const url: string = request.url;
    const segments = url.split('?')[0].split('/').filter(Boolean);
    if (segments.includes('vendor') && user.principalType !== 'VENDOR') {
      throw new ForbiddenException('Vendor access required');
    }
    if (segments.includes('customer') && user.principalType !== 'CUSTOMER') {
      throw new ForbiddenException('Customer access required');
    }

    // If no permissions are required for this route, allow through
    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const userPermissions: Set<string> = user.permissions ?? new Set<string>();

    // Wildcard grants full access (Enterprise Admin, Trustfabric Admin)
    if (userPermissions.has('*')) return true;

    const missing = requiredPermissions.filter((p) => !userPermissions.has(p));
    if (missing.length > 0) {
      throw new ForbiddenException(`Insufficient permissions. Required: ${missing.join(', ')}`);
    }

    return true;
  }
}
