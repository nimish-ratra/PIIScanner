import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './public.decorator.js';

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    
    if (!user) {
      throw new ForbiddenException('User not authenticated');
    }

    // Extract target company from params or body
    const targetCompanyId = request.params?.companyId || request.body?.companyId;

    if (!targetCompanyId) {
      // If no company context is required for this route, allow pass through
      return true;
    }

    // Tenant context validation
    if (user.allowedCompanyIds.includes('*')) {
      return true; // Enterprise admin has global access
    }

    if (!user.allowedCompanyIds.includes(targetCompanyId)) {
      throw new ForbiddenException(`Access denied for tenant context: ${targetCompanyId}`);
    }

    // Attach validated tenant context
    request.tenantContext = targetCompanyId;
    return true;
  }
}
