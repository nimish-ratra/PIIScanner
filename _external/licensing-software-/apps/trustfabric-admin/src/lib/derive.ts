/**
 * `deriveCustomers` derives an honest, real-data view of customers from the
 * entitlements a vendor can actually see — used only where an entitlement's
 * OWN list of customers matters (e.g. the dashboard's "top customers by
 * entitled seats" table). It never fabricates a customer that isn't backed
 * by at least one real Entitlement row.
 *
 * There used to be an equivalent `deriveProducts` here too, before
 * GET /vendor/products existed — removed now that the Products page and
 * dashboard both call the real endpoint directly.
 */

import type { Entitlement } from './types';

export interface CustomerSummary {
  enterpriseId: string;
  enterpriseName: string;
  entitlementCount: number;
  totalEntitled: number;
  totalAllocated: number;
  totalAvailable: number;
  productNames: string[];
  hasActiveEntitlement: boolean;
}

export function deriveCustomers(entitlements: Entitlement[]): CustomerSummary[] {
  const byEnterprise = new Map<string, CustomerSummary>();

  for (const ent of entitlements) {
    const enterpriseId = ent.enterpriseId;
    const enterpriseName = ent.enterprise?.name ?? enterpriseId;

    let summary = byEnterprise.get(enterpriseId);
    if (!summary) {
      summary = {
        enterpriseId,
        enterpriseName,
        entitlementCount: 0,
        totalEntitled: 0,
        totalAllocated: 0,
        totalAvailable: 0,
        productNames: [],
        hasActiveEntitlement: false,
      };
      byEnterprise.set(enterpriseId, summary);
    }

    summary.entitlementCount += 1;
    summary.totalEntitled += ent.quantity;
    summary.totalAllocated += ent.allocatedQuantity;
    summary.totalAvailable = summary.totalEntitled - summary.totalAllocated;
    if (ent.status === 'ACTIVE') summary.hasActiveEntitlement = true;

    const productName = ent.product?.name ?? ent.productId;
    if (!summary.productNames.includes(productName)) {
      summary.productNames.push(productName);
    }
  }

  return Array.from(byEnterprise.values()).sort((a, b) =>
    a.enterpriseName.localeCompare(b.enterpriseName),
  );
}

