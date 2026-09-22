'use client';

import React from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state';

/**
 * No vendor audit endpoint exists — AuditController only serves
 * /api/v1/customer/audit, which is hard-blocked for a VENDOR principal by
 * PermissionsGuard's principal-type check (by design: audit isolation is a
 * security boundary, not an oversight). Building a vendor/audit endpoint is
 * a real backend capability change and explicitly out of scope for this
 * phase, so this page is an honest "not available" state rather than
 * fabricated activity data.
 */
export default function AuditPage() {
  return (
    <div className="max-w-[1400px] mx-auto pb-12 flex flex-col h-[calc(100vh-8rem)]">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6 shrink-0">
        <PageHeader
          title="Audit Logs"
          description="Global operational history and security events across all customers"
        />
      </div>

      <div className="bg-white border border-zinc-200 rounded-xl flex flex-col flex-1 min-h-0 shadow-sm overflow-hidden">
        <div className="flex-1 flex items-center justify-center bg-zinc-50/30">
          <EmptyState
            title="Global Audit Log Not Available Yet"
            description="There is currently no vendor-scoped audit API — only customer-scoped audit logs exist, which are intentionally isolated per tenant. A global vendor audit endpoint is planned but not yet implemented."
          />
        </div>
      </div>
    </div>
  );
}
