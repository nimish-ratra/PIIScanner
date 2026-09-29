import { Injectable, Logger } from '@nestjs/common';
import * as msal from '@azure/msal-node';
import { decryptSecret } from './crypto.util.js';

export interface AzureADCredentials {
  tenantId: string;
  clientId: string;
  clientSecretEncrypted?: string | null;
  certificateThumbprint?: string | null;
}

@Injectable()
export class MsalAuthService {
  private readonly logger = new Logger(MsalAuthService.name);
  private readonly appCache = new Map<string, msal.ConfidentialClientApplication>();

  /**
   * Acquire an app-only application access token for Microsoft Graph
   * using the Client Credentials Flow (.default scope).
   */
  async getAccessToken(creds: AzureADCredentials): Promise<string> {
    const cacheKey = `${creds.tenantId}:${creds.clientId}`;
    let clientApp = this.appCache.get(cacheKey);

    if (!clientApp) {
      const clientSecret = creds.clientSecretEncrypted ? decryptSecret(creds.clientSecretEncrypted) : undefined;

      const msalConfig: msal.Configuration = {
        auth: {
          clientId: creds.clientId,
          authority: `https://login.microsoftonline.com/${creds.tenantId}`,
          clientSecret: clientSecret,
        },
      };

      clientApp = new msal.ConfidentialClientApplication(msalConfig);
      this.appCache.set(cacheKey, clientApp);
    }

    try {
      const result = await clientApp.acquireTokenByClientCredential({
        scopes: ['https://graph.microsoft.com/.default'],
      });

      if (!result?.accessToken) {
        throw new Error('MSAL returned null access token');
      }

      return result.accessToken;
    } catch (error: any) {
      this.logger.error(`Failed to acquire Microsoft Graph token for tenant ${creds.tenantId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Clear cached MSAL application instance (e.g. after credential rotation).
   */
  invalidateCache(tenantId: string, clientId: string) {
    this.appCache.delete(`${tenantId}:${clientId}`);
  }
}
