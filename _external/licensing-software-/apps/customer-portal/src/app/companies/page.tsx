'use client';

import React, { useState, useEffect } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState, LoadingState, ErrorState } from '@/components/ui/state';
import { useAuth } from '@/components/providers/auth-provider';
import { Card } from '@/components/ui/card';
import { apiClient } from '@/lib/api-client';

interface Company {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export default function CompaniesPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await apiClient<Company[]>('/companies');
      setCompanies(data);
    } catch (err: any) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);
  
  if (!user.roles.includes('EnterpriseAdmin') && !user.roles.includes('CompanyAdmin')) {
    return <EmptyState title="Unauthorized" description="You do not have permission to view companies." />;
  }

  if (loading) return <LoadingState message="Loading companies..." />;
  if (error) return <ErrorState error={error} onRetry={loadData} />;

  return (
    <div>
      <PageHeader title="Companies" description="Manage subsidiary organizations" />
      
      {companies.length === 0 ? (
        <EmptyState 
          title="No Companies Found" 
          description="There are currently no companies registered under your enterprise."
          action={<button onClick={loadData} className="px-4 py-2 bg-slate-900 text-white rounded-md text-sm font-medium hover:bg-slate-800">Refresh</button>}
        />
      ) : (
        <Card>
          <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead>
                  <tr style={{ borderBottom: '1px solid oklch(0.91 0 0)' }}>
                    <th className="px-4 py-2.5 text-[11px] font-medium text-zinc-400 uppercase tracking-wide">Company Name</th>
                    <th className="px-4 py-2.5 text-[11px] font-medium text-zinc-400 uppercase tracking-wide">Status</th>
                    <th className="px-4 py-2.5 text-[11px] font-medium text-zinc-400 uppercase tracking-wide">Created</th>
                    <th className="px-4 py-2.5 text-[11px] font-medium text-zinc-400 uppercase tracking-wide text-right">Actions</th>
                  </tr>
                </thead>
              <tbody>
                  {companies.map((company) => (
                    <tr key={company.id}
                        className="hover:bg-zinc-50/60 transition-colors"
                        style={{ borderBottom: '1px solid oklch(0.95 0 0)' }}>
                      <td className="px-4 py-3 font-medium text-zinc-800">{company.name}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
                          Active
                        </span>
                      </td>
                      <td className="px-4 py-3 text-zinc-400 text-xs">{new Date(company.createdAt).toLocaleDateString()}</td>
                      <td className="px-4 py-3 text-right">
                        <button className="text-xs font-medium text-zinc-500 hover:text-zinc-900 transition-colors">View</button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      
      <div className="mt-8">
        <EmptyState 
          title="Full Management Coming Soon" 
          description="Detailed company lifecycle management (creation, deletion) will be added in Phase 4B."
        />
      </div>
    </div>
  );
}
