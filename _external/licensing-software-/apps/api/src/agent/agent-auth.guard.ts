/**
 * AgentAuthGuard
 *
 * Authenticates a single Installation, never a User. Credentials are issued
 * once at /agent/register (installationId + a random secret, returned as
 * `installationId.secret`) and never rotate implicitly — compromise of one
 * agent credential can only ever affect that one Installation's seat, never
 * the owning Company or Enterprise (see docs/agent-protocol.md).
 *
 * This guard is applied explicitly (@UseGuards) on individual AgentController
 * routes. The controller itself is @Public() so the global AuthGuard /
 * TenantGuard / PermissionsGuard (which only understand session-based
 * CUSTOMER/VENDOR principals) do not run against it.
 */

import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { safeCompareHash } from './crypto.util.js';

@Injectable()
export class AgentAuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const header: string | undefined = request.headers?.['authorization'];

    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing agent credential');
    }

    const credential = header.slice('Bearer '.length).trim();
    const separatorIndex = credential.indexOf('.');
    if (separatorIndex <= 0 || separatorIndex === credential.length - 1) {
      throw new UnauthorizedException('Malformed agent credential');
    }

    const installationId = credential.slice(0, separatorIndex);
    const secret = credential.slice(separatorIndex + 1);

    const installation = await this.prisma.installation.findUnique({ where: { id: installationId } });
    if (!installation || !installation.credentialHash) {
      throw new UnauthorizedException('Unknown installation');
    }

    if (!safeCompareHash(secret, installation.credentialHash)) {
      throw new UnauthorizedException('Invalid agent credential');
    }

    if (installation.status === 'REVOKED') {
      // A revoked installation's credential must stop working outright — it no
      // longer holds a seat, so there is nothing left for it to authenticate to.
      throw new UnauthorizedException('Installation has been revoked');
    }

    request.installation = installation;
    return true;
  }
}
