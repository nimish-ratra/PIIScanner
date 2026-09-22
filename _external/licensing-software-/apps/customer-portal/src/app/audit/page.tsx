'use client';

import React, { useState, useEffect } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState, LoadingState, ErrorState } from '@/components/ui/state';
import { useAuth } from '@/components/providers/auth-provider';
import { apiClient } from '@/lib/api-client';
import { Card } from '@/components/ui/card';

interface AuditEvent {
  id: string;
  action: string;
  actorId: string;
  targetType: string;
  result: string;
  companyId?: string;
  company?: { name: string };
  createdAt: string;
}

const ACTION_LABELS: Record<string, { label: string; badgeClass?: string }> = {
  AGENT_COMMAND_ISSUED: { label: 'Agent Command Issued', badgeClass: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200' },
  AGENT_COMMAND_ACKNOWLEDGED: { label: 'Agent Command Acknowledged', badgeClass: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' },
  AGENT_COMMAND_CANCELLED: { label: 'Agent Command Cancelled', badgeClass: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200' },
  UPDATE_COMPANY_TELEMETRY_SETTINGS: { label: 'Updated Fleet Telemetry Policy', badgeClass: 'bg-purple-50 text-purple-700 ring-1 ring-purple-200' },
  FIRST_TELEMETRY_RECEIVED: { label: 'First Telemetry Received', badgeClass: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' },
  SERVICE_STATE_TRANSITION: { label: 'Service State Transition', badgeClass: 'bg-zinc-100 text-zinc-700 ring-1 ring-zinc-200' },
  APPROVE_INSTALLATION: { label: 'Approve Installation', badgeClass: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' },
  REJECT_INSTALLATION: { label: 'Reject Installation', badgeClass: 'bg-red-50 text-red-700 ring-1 ring-red-200' },
  SUSPEND_INSTALLATION: { label: 'Suspend Installation', badgeClass: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200' },
  REVOKE_INSTALLATION: { label: 'Revoke Installation', badgeClass: 'bg-red-50 text-red-700 ring-1 ring-red-200' },
};

export default function AuditPage() {
  const { user, selectedCompanyId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [events, setEvents] = useState<AuditEvent[]>([]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const queryParams = new URLSearchParams();
      if (selectedCompanyId !== '*') {
        queryParams.append('companyId', selectedCompanyId);
      }
      
      const res = await apiClient<{data: AuditEvent[]}>(`/audit?${queryParams.toString()}`);
      setEvents(res.data);
    } catch (err: any) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [selectedCompanyId, user]);
  
  if (!user.roles.includes('EnterpriseAdmin') && !user.roles.includes('CompanyAdmin')) {
    return <EmptyState title="Unauthorized" description="You do not have permission to view audit logs." />;
  }

  if (loading) return <LoadingState message="Loading audit logs..." />;
  if (error) return <ErrorState error={error} onRetry={loadData} />;

  return (
    <div>
      <PageHeader title="Audit Logs" description="Review operational history and security events" />
      
      {events.length === 0 ? (
        <EmptyState 
          title="No Audit Logs Found" 
          description="There are currently no events matching your context."
          action={<button onClick={loadData} className="px-4 py-2 bg-slate-900 text-white rounded-md text-sm font-medium hover:bg-slate-800">Refresh</button>}
        />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-slate-500 bg-slate-50 border-b uppercase">
                <tr>
                  <th className="px-6 py-3 font-medium">Timestamp</th>
                  <th className="px-6 py-3 font-medium">Action</th>
                  <th className="px-6 py-3 font-medium">Actor</th>
                  <th className="px-6 py-3 font-medium">Target</th>
                  <th className="px-6 py-3 font-medium">Company</th>
                  <th className="px-6 py-3 font-medium">Result</th>
                </tr>
              </thead>
              <tbody>
                {events.map((evt) => (
                  <tr key={evt.id} className="border-b last:border-0 hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4 text-slate-500 whitespace-nowrap">{new Date(evt.createdAt).toLocaleString()}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${ACTION_LABELS[evt.action]?.badgeClass || 'bg-slate-100 text-slate-800'}`}>
                        {ACTION_LABELS[evt.action]?.label || evt.action.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-6 py-4">{evt.actorId}</td>
                    <td className="px-6 py-4">{evt.targetType}</td>
                    <td className="px-6 py-4">{evt.company?.name || evt.companyId || '-'}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${evt.result === 'SUCCESS' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                        {evt.result}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
