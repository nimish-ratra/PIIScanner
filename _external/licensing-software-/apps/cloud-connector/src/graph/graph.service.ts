import { Injectable, Logger } from '@nestjs/common';
import { Client } from '@microsoft/microsoft-graph-client';
import { MsalAuthService, AzureADCredentials } from '../auth/msal-auth.service.js';

export interface GraphSite {
  id: string;
  name: string;
  displayName: string;
  webUrl: string;
}

export interface GraphUserDrive {
  id: string;
  userPrincipalName: string;
  displayName: string;
  driveId: string;
}

export interface GraphDriveItem {
  id: string;
  name: string;
  webUrl?: string;
  size?: number;
  lastModifiedDateTime?: string;
  file?: {
    mimeType?: string;
    hashes?: { sha256Hash?: string };
  };
  folder?: any;
  parentReference?: {
    id?: string;
    path?: string;
    driveId?: string;
    siteId?: string;
  };
  deleted?: any;
}

export interface DeltaResult {
  items: GraphDriveItem[];
  nextDeltaLink: string;
}

@Injectable()
export class GraphService {
  private readonly logger = new Logger(GraphService.name);

  constructor(private readonly msalAuth: MsalAuthService) {}

  /**
   * Instantiate an authenticated Microsoft Graph Client for a specific company's credentials.
   */
  getGraphClient(creds: AzureADCredentials): Client {
    return Client.init({
      authProvider: async (done) => {
        try {
          const token = await this.msalAuth.getAccessToken(creds);
          done(null, token);
        } catch (err: any) {
          done(err, null);
        }
      },
    });
  }

  /**
   * Enumerate all SharePoint Team Sites across the tenant.
   */
  async enumerateSites(creds: AzureADCredentials): Promise<GraphSite[]> {
    const client = this.getGraphClient(creds);
    try {
      // Sites query: search for all sites
      const res = await client.api('/sites?search=*&$select=id,name,displayName,webUrl').get();
      const sites: GraphSite[] = (res.value || []).map((s: any) => ({
        id: s.id,
        name: s.name || s.displayName || 'Unnamed Site',
        displayName: s.displayName || s.name || 'Unnamed Site',
        webUrl: s.webUrl || '',
      }));
      return sites;
    } catch (err: any) {
      this.logger.error(`Error enumerating SharePoint sites: ${err.message}`);
      return [];
    }
  }

  /**
   * Enumerate OneDrive default drives for all active employees.
   */
  async enumerateUserDrives(creds: AzureADCredentials): Promise<GraphUserDrive[]> {
    const client = this.getGraphClient(creds);
    try {
      const res = await client.api('/users?$select=id,displayName,userPrincipalName&$top=100').get();
      const users = res.value || [];
      const userDrives: GraphUserDrive[] = [];

      for (const user of users) {
        try {
          const driveRes = await client.api(`/users/${user.id}/drive?$select=id`).get();
          if (driveRes?.id) {
            userDrives.push({
              id: user.id,
              userPrincipalName: user.userPrincipalName,
              displayName: user.displayName || user.userPrincipalName,
              driveId: driveRes.id,
            });
          }
        } catch (driveErr: any) {
          // User might not have OneDrive provisioned yet
          this.logger.debug(`User ${user.userPrincipalName} has no OneDrive provisioned: ${driveErr.message}`);
        }
      }

      return userDrives;
    } catch (err: any) {
      this.logger.error(`Error enumerating user OneDrive drives: ${err.message}`);
      return [];
    }
  }

  /**
   * Enumerate a SharePoint Site's default document library driveId.
   */
  async getSiteDefaultDriveId(creds: AzureADCredentials, siteId: string): Promise<string | null> {
    const client = this.getGraphClient(creds);
    try {
      const res = await client.api(`/sites/${siteId}/drive?$select=id`).get();
      return res?.id || null;
    } catch (err: any) {
      this.logger.debug(`Could not retrieve drive for site ${siteId}: ${err.message}`);
      return null;
    }
  }

  /**
   * Query changes on a drive using Graph's /delta endpoint.
   * If deltaLink is supplied, fetches only changes since the last delta.
   */
  async getDriveDelta(
    creds: AzureADCredentials,
    driveId: string,
    existingDeltaLink?: string | null,
  ): Promise<DeltaResult> {
    const client = this.getGraphClient(creds);
    const items: GraphDriveItem[] = [];
    let currentUrl = existingDeltaLink || `/drives/${driveId}/root/delta`;

    while (currentUrl) {
      let pageRes: any;
      if (currentUrl.startsWith('http')) {
        // Query full URL returned by @odata.nextLink or @odata.deltaLink
        pageRes = await client.api(currentUrl).get();
      } else {
        pageRes = await client.api(currentUrl).get();
      }

      if (pageRes.value && Array.isArray(pageRes.value)) {
        for (const item of pageRes.value) {
          // Ignore deleted items or pure folder containers if needed, but include files
          items.push(item);
        }
      }

      if (pageRes['@odata.nextLink']) {
        currentUrl = pageRes['@odata.nextLink'];
      } else if (pageRes['@odata.deltaLink']) {
        return {
          items,
          nextDeltaLink: pageRes['@odata.deltaLink'],
        };
      } else {
        break;
      }
    }

    return {
      items,
      nextDeltaLink: currentUrl,
    };
  }

  /**
   * Download a file's raw binary content stream.
   */
  async downloadItemContent(creds: AzureADCredentials, driveId: string, itemId: string): Promise<Buffer> {
    const client = this.getGraphClient(creds);
    const stream = await client.api(`/drives/${driveId}/items/${itemId}/content`).getStream();
    
    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', (err: any) => reject(err));
    });
  }

  /**
   * Upload a new version of an item (preserves version history automatically).
   */
  async uploadNewVersion(creds: AzureADCredentials, driveId: string, itemId: string, content: Buffer): Promise<any> {
    const client = this.getGraphClient(creds);
    return client.api(`/drives/${driveId}/items/${itemId}/content`).put(content);
  }

  /**
   * Remove external/shared sharing permissions on a sensitive item (§1.5).
   */
  async stripSharingPermissions(creds: AzureADCredentials, driveId: string, itemId: string): Promise<string[]> {
    const client = this.getGraphClient(creds);
    const removedIds: string[] = [];

    try {
      const permsRes = await client.api(`/drives/${driveId}/items/${itemId}/permissions`).get();
      const perms = permsRes.value || [];

      for (const perm of perms) {
        // Strip link permissions and non-owner guest permissions
        if (perm.link || perm.roles?.includes('write') || perm.roles?.includes('read')) {
          try {
            await client.api(`/drives/${driveId}/items/${itemId}/permissions/${perm.id}`).delete();
            removedIds.push(perm.id);
          } catch (delErr: any) {
            this.logger.debug(`Skipped deleting permission ${perm.id}: ${delErr.message}`);
          }
        }
      }
    } catch (err: any) {
      this.logger.error(`Error stripping permissions on item ${itemId}: ${err.message}`);
    }

    return removedIds;
  }

  /**
   * Move an item to a designated restricted Quarantine folder (§1.5).
   * Automatically creates the folder if it does not exist.
   */
  async moveToQuarantineFolder(
    creds: AzureADCredentials,
    driveId: string,
    itemId: string,
    quarantineFolderName: string = 'clAIssify-Quarantine',
  ): Promise<string> {
    const client = this.getGraphClient(creds);

    // 1. Locate or create Quarantine folder at root of drive
    let quarantineFolderId: string;
    try {
      const searchRes = await client.api(`/drives/${driveId}/root/children?$filter=name eq '${quarantineFolderName}'`).get();
      if (searchRes.value && searchRes.value.length > 0) {
        quarantineFolderId = searchRes.value[0].id;
      } else {
        const createRes = await client.api(`/drives/${driveId}/root/children`).post({
          name: quarantineFolderName,
          folder: {},
          '@microsoft.graph.conflictBehavior': 'rename',
        });
        quarantineFolderId = createRes.id;
      }
    } catch (createErr: any) {
      this.logger.error(`Failed to locate/create quarantine folder: ${createErr.message}`);
      throw createErr;
    }

    // 2. Move item by updating parentReference (preserves version history!)
    await client.api(`/drives/${driveId}/items/${itemId}`).patch({
      parentReference: {
        id: quarantineFolderId,
      },
    });

    return quarantineFolderId;
  }
}
