'use client';

import React from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state';
import { useAuth } from '@/components/providers/auth-provider';

export default function SettingsPage() {
  const { user } = useAuth();
  
  if (!user.roles.includes('TrustfabricAdmin')) {
    return (
      <div className="max-w-[1400px] mx-auto pb-12 flex flex-col h-[calc(100vh-8rem)]">
        <PageHeader title="Settings" description="Global platform configuration" />
        <div className="bg-white border border-zinc-200 rounded-xl flex flex-col flex-1 min-h-0 shadow-sm overflow-hidden mt-6">
          <div className="flex-1 flex items-center justify-center bg-zinc-50/30">
            <EmptyState 
              title="Unauthorized" 
              description="You do not have permission to view global platform settings." 
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[1400px] mx-auto pb-12 flex flex-col h-[calc(100vh-8rem)]">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6 shrink-0">
        <PageHeader 
          title="Settings" 
          description="Global platform configuration and operational policies" 
        />
      </div>

      <div className="bg-white border border-zinc-200 rounded-xl flex flex-col flex-1 min-h-0 shadow-sm overflow-hidden">
        <div className="flex-1 flex items-center justify-center bg-zinc-50/30">
          <EmptyState 
            title="Settings Management Unavailable" 
            description="Configuration models are not yet supported by the backend APIs."
          />
        </div>
      </div>
    </div>
  );
}
