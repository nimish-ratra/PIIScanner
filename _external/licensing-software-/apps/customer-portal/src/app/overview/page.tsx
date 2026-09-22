'use client';

import React, { useEffect, useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { LoadingState, ErrorState } from '@/components/ui/state';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/components/providers/auth-provider';
import { ShieldCheck, Users, Key, Monitor, ArrowRight, Plus, FileText, UserCheck, Gauge, Clock3, Activity, CheckCircle2, XCircle } from 'lucide-react';
import Link from 'next/link';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import type { LicenseAllocation, LicenseRequest, TelemetrySummaryResponse } from '@/lib/types';

export default function OverviewPage() {
  const { selectedCompanyId, user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const [summary, setSummary] = useState<{
    totalEntitled: number;
    totalAllocated: number;
    activeInstallations: number;
  }>({ totalEntitled: 0, totalAllocated: 0, activeInstallations: 0 });

  const [totalConsumed, setTotalConsumed] = useState(0);
  const [pendingRequestCount, setPendingRequestCount] = useState(0);
  const [companyUtilization, setCompanyUtilization] = useState<any[]>([]);
  const [recentRequests, setRecentRequests] = useState<any[]>([]);
  const [recentActivity, setRecentActivity] = useState<any[]>([]);
  const [telemetrySummary, setTelemetrySummary] = useState<TelemetrySummaryResponse | null>(null);

  const isEnterpriseScope = selectedCompanyId === '*';

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        setError(null);

        const summaryRes = await apiClient<any>('/licenses/summary');
        setSummary({
          totalEntitled:      summaryRes.totalEntitled,
          totalAllocated:     summaryRes.totalAllocated,
          activeInstallations: summaryRes.activeInstallations,
        });
        setCompanyUtilization(summaryRes.companyUtilization || []);

        // Load allocations, requests, activity, and telemetry fleet summary
        const telemetryQuery = selectedCompanyId !== '*' ? `?companyId=${selectedCompanyId}&days=7` : '?days=7';
        const [allocationsRes, requestsRes, auditRes, telemetryRes] = await Promise.allSettled([
          apiClient<LicenseAllocation[]>('/licenses'),
          apiClient<LicenseRequest[]>('/license-requests'),
          apiClient<{ data: any[] }>('/audit?limit=4'),
          apiClient<TelemetrySummaryResponse>(`/customer/telemetry/summary${telemetryQuery}`)
        ]);

        if (allocationsRes.status === 'fulfilled') {
          setTotalConsumed(allocationsRes.value.reduce((sum, a) => sum + a.consumedQuantity, 0));
        }
        if (requestsRes.status === 'fulfilled') {
          setRecentRequests(requestsRes.value.slice(0, 4));
          setPendingRequestCount(requestsRes.value.filter((r) => r.status === 'PENDING').length);
        }
        if (auditRes.status === 'fulfilled') {
          setRecentActivity(auditRes.value.data);
        }
        if (telemetryRes.status === 'fulfilled') {
          setTelemetrySummary(telemetryRes.value);
        }

      } catch (err: any) {
        setError(err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [selectedCompanyId, user]);

  if (loading) return <LoadingState message="Loading dashboard..." />;
  if (error) return <ErrorState error={error} />;

  const { totalEntitled, totalAllocated, activeInstallations } = summary;
  const availableToAllocate = totalEntitled - totalAllocated;
  const availableToConsume = totalAllocated - totalConsumed;

  const stats = [
    {
      label: 'Total Entitled Seats',
      value: totalEntitled,
      sub: 'Across all products',
      icon: ShieldCheck,
      color: 'blue',
    },
    {
      label: 'Allocated Seats',
      value: totalAllocated,
      sub: isEnterpriseScope ? 'Assigned to subsidiaries' : 'Assigned to your company',
      icon: Users,
      color: 'emerald',
    },
    {
      label: 'Consumed Seats',
      value: totalConsumed,
      sub: 'Held by active installations',
      icon: Gauge,
      color: 'purple',
    },
    ...(isEnterpriseScope
      ? [{ label: 'Available to Allocate', value: availableToAllocate, sub: 'Remaining enterprise capacity', icon: Key, color: 'amber' as const }]
      : [{ label: 'Available Seats', value: availableToConsume, sub: 'Allocated but not yet consumed', icon: Key, color: 'amber' as const }]),
    {
      label: 'Active Installations',
      value: activeInstallations,
      sub: 'Endpoints reporting telemetry',
      icon: Monitor,
      color: 'purple',
    },
    {
      label: 'Pending Requests',
      value: pendingRequestCount,
      sub: 'Awaiting admin review',
      icon: Clock3,
      color: 'amber',
    },
  ];

  const COLORS = ['#3b82f6', '#60a5fa', '#93c5fd', '#bfdbfe', '#dbeafe'];

  const getStatusConfig = (status: string) => {
    switch (status) {
      case 'PENDING': return { label: 'Pending', classes: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200' };
      case 'APPROVED': return { label: 'Approved', classes: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' };
      case 'REJECTED': return { label: 'Rejected', classes: 'bg-red-50 text-red-700 ring-1 ring-red-200' };
      default: return { label: status, classes: 'bg-zinc-100 text-zinc-600 ring-1 ring-zinc-200' };
    }
  };

  const getActionIcon = (action: string) => {
    if (action.includes('APPROVE')) return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
    if (action.includes('REJECT')) return <XCircle className="h-4 w-4 text-red-500" />;
    if (action.includes('COMPANY')) return <ShieldCheck className="h-4 w-4 text-blue-500" />;
    if (action.includes('ALLOCATE')) return <Key className="h-4 w-4 text-blue-500" />;
    return <Activity className="h-4 w-4 text-zinc-400" />;
  };

  const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <div className="max-w-[1400px] mx-auto pb-12">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6">
        <PageHeader
          title="Overview"
          description={isEnterpriseScope ? 'Your enterprise licensing at a glance' : 'Your company licensing summary'}
        />
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        {stats.map((s) => {
          const Icon = s.icon;
          const bgColors: Record<string, string> = {
            blue: 'bg-blue-50 text-blue-500',
            emerald: 'bg-emerald-50 text-emerald-500',
            amber: 'bg-amber-50 text-amber-500',
            purple: 'bg-purple-50 text-purple-500',
          };

          return (
            <Card key={s.label} className="border border-zinc-200/60 shadow-sm overflow-hidden">
              <CardContent className="p-5">
                <div className="flex items-start gap-4">
                  <div className={`h-12 w-12 rounded-xl flex items-center justify-center shrink-0 ${bgColors[s.color]}`}>
                    <Icon className="h-6 w-6" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-zinc-500">{s.label}</p>
                    <div className="text-3xl font-bold text-zinc-900 tabular-nums leading-none">
                      {s.value.toLocaleString()}
                    </div>
                    <p className="text-xs text-zinc-400">{s.sub}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Fleet Telemetry & Protection KPIs */}
      {telemetrySummary && (
        <div className="mb-6 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Fleet Protection & Telemetry (7 Days)
            </h3>
            <Link
              href="/telemetry"
              className="text-xs font-medium text-blue-600 hover:text-blue-700 flex items-center transition-colors"
            >
              Open Fleet Protection <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Link>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {/* Protected Devices */}
            <Card className="border border-zinc-200/60 shadow-sm">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-zinc-500">Protected Devices</span>
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                </div>
                <div className="mt-2 text-2xl font-bold text-zinc-900">
                  {telemetrySummary.totalProtected}{' '}
                  <span className="text-xs font-normal text-zinc-400">/ {telemetrySummary.totalDevices} live</span>
                </div>
                <p className="text-[11px] text-zinc-400 mt-1">
                  {telemetrySummary.totalDevices > 0
                    ? `${Math.round((telemetrySummary.totalProtected / telemetrySummary.totalDevices) * 100)}% fleet coverage`
                    : 'No devices registered'}
                </p>
              </CardContent>
            </Card>

            {/* Stale / Offline */}
            <Card className="border border-zinc-200/60 shadow-sm">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-zinc-500">Stale or Offline</span>
                  <span className="h-2 w-2 rounded-full bg-amber-500" />
                </div>
                <div className="mt-2 text-2xl font-bold text-amber-600">
                  {telemetrySummary.staleOrOffline}
                </div>
                <p className="text-[11px] text-zinc-400 mt-1">Endpoints missing recent ping</p>
              </CardContent>
            </Card>

            {/* Files Audited */}
            <Card className="border border-zinc-200/60 shadow-sm">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-zinc-500">Files Audited (7d)</span>
                  <FileText className="h-4 w-4 text-blue-500" />
                </div>
                <div className="mt-2 text-2xl font-bold text-zinc-900">
                  {telemetrySummary.filesScanned.toLocaleString()}
                </div>
                <p className="text-[11px] text-zinc-400 mt-1">Scanned by ClAIssify agents</p>
              </CardContent>
            </Card>

            {/* Findings by Tier */}
            <Card className="border border-zinc-200/60 shadow-sm">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-zinc-500">Findings by Tier</span>
                  <ShieldCheck className="h-4 w-4 text-purple-500" />
                </div>
                <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                  {Object.entries(telemetrySummary.findingsByTier).length > 0 ? (
                    Object.entries(telemetrySummary.findingsByTier).map(([t, count]) => (
                      <span
                        key={t}
                        className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-zinc-100 text-zinc-700"
                        title={`${t}: ${count}`}
                      >
                        {t.slice(0, 4)}: {count}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-zinc-400">0 findings</span>
                  )}
                </div>
                <p className="text-[11px] text-zinc-400 mt-1">Confidential & above</p>
              </CardContent>
            </Card>

            {/* Enforcement Actions */}
            <Card className="border border-zinc-200/60 shadow-sm">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-zinc-500">DLP Actions</span>
                  <Activity className="h-4 w-4 text-red-500" />
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-red-600">
                    {telemetrySummary.enforcementByAction.block || 0}
                  </span>
                  <span className="text-xs text-zinc-400">
                    blk / {telemetrySummary.enforcementByAction.quarantine || 0} quar / {telemetrySummary.enforcementByAction.override || 0} over
                  </span>
                </div>
                <p className="text-[11px] text-zinc-400 mt-1">Real-time save actions</p>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Middle Grid */}
      {isEnterpriseScope && (
        <div className="grid gap-4 lg:grid-cols-3 mb-6">
          <Card className="lg:col-span-2 border border-zinc-200/60 shadow-sm overflow-hidden flex flex-col">
            <CardHeader className="flex flex-row items-center justify-between pb-4 pt-5 px-5">
              <div className="space-y-1">
                <CardTitle className="text-base">Company Utilization</CardTitle>
                <p className="text-xs text-zinc-500">Seat allocation across your subsidiaries</p>
              </div>
              <Link href="/companies" className="text-xs font-medium text-zinc-700 bg-zinc-50 hover:bg-zinc-100 px-3 py-1.5 rounded-md border border-zinc-200 flex items-center transition-colors">
                View all companies <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Link>
            </CardHeader>
            <div className="overflow-x-auto flex-1">
              <table className="w-full text-sm text-left">
                <thead>
                  <tr className="border-b border-zinc-100">
                    {['COMPANY', 'ALLOCATED', 'ACTIVE', 'AVAILABLE', 'UTILIZATION', 'STATUS'].map((col, i) => (
                      <th
                        key={col}
                        className={`px-5 py-3 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider ${i > 0 && col !== 'STATUS' ? 'text-right' : ''} ${col === 'STATUS' ? 'text-center' : ''}`}
                      >
                        {col}
                      </th>
                    ))}
                    <th className="px-5 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {companyUtilization.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-5 py-12 text-center text-zinc-400 text-xs">
                        No allocations found across companies.
                      </td>
                    </tr>
                  ) : (
                    companyUtilization.slice(0, 4).map((comp) => {
                      const utilPct = comp.allocated > 0 ? Math.round((comp.active / comp.allocated) * 100) : 0;
                      const isWarning = utilPct > 90;
                      
                      // Simple country flag mock based on name
                      let flag = '🌐';
                      if (comp.companyName.includes('India')) flag = '🇮🇳';
                      if (comp.companyName.includes('UK')) flag = '🇬🇧';
                      if (comp.companyName.includes('Germany')) flag = '🇩🇪';
                      if (comp.companyName.includes('US') || comp.companyName.includes('America')) flag = '🇺🇸';

                      return (
                        <tr key={comp.companyId} className="border-b border-zinc-50 last:border-0 hover:bg-zinc-50/50 transition-colors">
                          <td className="px-5 py-3.5 text-sm font-medium text-zinc-900 flex items-center gap-2">
                            <span className="text-base">{flag}</span>
                            {comp.companyName}
                          </td>
                          <td className="px-5 py-3.5 text-right text-zinc-600 tabular-nums">{comp.allocated}</td>
                          <td className="px-5 py-3.5 text-right text-zinc-600 tabular-nums">{comp.active}</td>
                          <td className="px-5 py-3.5 text-right text-zinc-600 tabular-nums">{comp.allocated - comp.active}</td>
                          <td className="px-5 py-3.5 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <div className="h-1.5 w-16 bg-zinc-100 rounded-full overflow-hidden">
                                <div className={`h-full rounded-full ${isWarning ? 'bg-amber-500' : 'bg-blue-500'}`} style={{ width: `${utilPct}%` }} />
                              </div>
                              <span className="text-xs text-zinc-500 w-6 tabular-nums">{utilPct}%</span>
                            </div>
                          </td>
                          <td className="px-5 py-3.5 text-center">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold tracking-wide uppercase ${
                              isWarning
                                ? 'bg-amber-50 text-amber-600 ring-1 ring-amber-200'
                                : 'bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200'
                            }`}>
                              {isWarning ? 'Warning' : 'Healthy'}
                            </span>
                          </td>
                          <td className="px-5 py-3.5 text-right text-zinc-300">
                            •••
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="border border-zinc-200/60 shadow-sm overflow-hidden flex flex-col">
            <CardHeader className="pb-0 pt-5 px-5">
              <CardTitle className="text-base">Allocation Overview</CardTitle>
              <p className="text-xs text-zinc-500 mt-1">Current allocation across subsidiaries</p>
            </CardHeader>
            <CardContent className="flex-1 flex items-center justify-center p-5 pt-0">
              {companyUtilization.length === 0 ? (
                <div className="text-xs text-zinc-400">No data</div>
              ) : (
                <div className="flex items-center justify-between w-full mt-4">
                  <div className="relative h-32 w-32 shrink-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={companyUtilization}
                          cx="50%"
                          cy="50%"
                          innerRadius={42}
                          outerRadius={60}
                          paddingAngle={2}
                          dataKey="allocated"
                          stroke="none"
                        >
                          {companyUtilization.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={{ fontSize: '12px', borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                      <span className="text-lg font-bold text-zinc-900 leading-none">{totalAllocated}</span>
                      <span className="text-[10px] text-zinc-400 mt-1">Allocated</span>
                    </div>
                  </div>
                  
                  <div className="flex flex-col gap-2.5 ml-4 flex-1">
                    {companyUtilization.slice(0, 3).map((comp, idx) => {
                      const pct = totalAllocated > 0 ? Math.round((comp.allocated / totalAllocated) * 100) : 0;
                      return (
                        <div key={comp.companyId} className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2 text-zinc-600 font-medium">
                            <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: COLORS[idx % COLORS.length] }} />
                            <span className="truncate max-w-[90px]" title={comp.companyName}>{comp.companyName}</span>
                          </div>
                          <div className="text-zinc-500 tabular-nums">
                            {comp.allocated} <span className="text-zinc-400">({pct}%)</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Bottom Grid */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Recent License Requests */}
        <Card className="border border-zinc-200/60 shadow-sm overflow-hidden flex flex-col">
          <CardHeader className="flex flex-row items-center justify-between pb-4 pt-5 px-5">
            <div className="space-y-1">
              <CardTitle className="text-base">Recent License Requests</CardTitle>
              <p className="text-xs text-zinc-500">Latest employee license requests</p>
            </div>
            <Link href="/license-requests" className="text-xs font-medium text-zinc-700 bg-zinc-50 hover:bg-zinc-100 px-3 py-1.5 rounded-md border border-zinc-200 flex items-center transition-colors">
              View all <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Link>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-zinc-100">
                  {['EMPLOYEE', 'COMPANY', 'PRODUCT', 'STATUS', 'DATE'].map((col) => (
                    <th key={col} className="px-5 py-2.5 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recentRequests.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-5 py-8 text-center text-zinc-400">No recent requests</td>
                  </tr>
                ) : (
                  recentRequests.map(req => {
                    const cfg = getStatusConfig(req.status);
                    return (
                      <tr key={req.id} className="border-b border-zinc-50 last:border-0 hover:bg-zinc-50/50">
                        <td className="px-5 py-3 font-medium text-zinc-800">{req.requestedBy || 'Unknown'}</td>
                        <td className="px-5 py-3 text-zinc-600 truncate max-w-[100px]">{req.company?.name || '—'}</td>
                        <td className="px-5 py-3 text-zinc-600 truncate max-w-[120px]">{req.entitlement?.product?.name || '—'}</td>
                        <td className="px-5 py-3">
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${cfg.classes}`}>
                            {cfg.label}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-zinc-500 whitespace-nowrap">{fmtDate(req.createdAt)}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Recent Activity */}
        <Card className="border border-zinc-200/60 shadow-sm overflow-hidden flex flex-col">
          <CardHeader className="flex flex-row items-center justify-between pb-4 pt-5 px-5">
            <div className="space-y-1">
              <CardTitle className="text-base">Recent Activity</CardTitle>
              <p className="text-xs text-zinc-500">Latest actions in your organization</p>
            </div>
            <button className="text-xs font-medium text-zinc-700 bg-zinc-50 hover:bg-zinc-100 px-3 py-1.5 rounded-md border border-zinc-200 flex items-center transition-colors">
              View all <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </button>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-zinc-100">
                  {['EVENT', 'ACTOR', 'DATE'].map((col) => (
                    <th key={col} className="px-5 py-2.5 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recentActivity.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-5 py-8 text-center text-zinc-400">No recent activity</td>
                  </tr>
                ) : (
                  recentActivity.map(event => (
                    <tr key={event.id} className="border-b border-zinc-50 last:border-0 hover:bg-zinc-50/50">
                      <td className="px-5 py-3 flex items-center gap-2">
                        <div className="h-6 w-6 rounded flex items-center justify-center bg-blue-50 shrink-0">
                          {getActionIcon(event.action)}
                        </div>
                        <span className="text-zinc-800 font-medium truncate max-w-[160px]" title={event.action}>
                          {event.action.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (l: string) => l.toUpperCase())}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-zinc-600 truncate max-w-[120px]" title={event.actorId}>{event.actorId}</td>
                      <td className="px-5 py-3 text-zinc-500 whitespace-nowrap">{fmtDate(event.createdAt)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Quick Actions */}
        <Card className="border border-zinc-200/60 shadow-sm overflow-hidden flex flex-col">
          <CardHeader className="pb-4 pt-5 px-5">
            <CardTitle className="text-base">Quick Actions</CardTitle>
            <p className="text-xs text-zinc-500 mt-1">Common tasks</p>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            <div className="space-y-2.5">
              <Link href="/companies" className="flex items-center justify-between p-3 rounded-lg border border-zinc-200/80 hover:border-blue-200 hover:bg-blue-50/30 transition-all group">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-md bg-blue-50 text-blue-500 flex items-center justify-center shrink-0">
                    <Plus className="h-4 w-4" />
                  </div>
                  <span className="text-sm font-medium text-zinc-800">Manage Companies</span>
                </div>
                <ArrowRight className="h-4 w-4 text-zinc-300 group-hover:text-blue-500 transition-colors" />
              </Link>
              
              <Link href="/licenses" className="flex items-center justify-between p-3 rounded-lg border border-zinc-200/80 hover:border-blue-200 hover:bg-blue-50/30 transition-all group">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-md bg-blue-50 text-blue-500 flex items-center justify-center shrink-0">
                    <FileText className="h-4 w-4" />
                  </div>
                  <span className="text-sm font-medium text-zinc-800">View All Licenses</span>
                </div>
                <ArrowRight className="h-4 w-4 text-zinc-300 group-hover:text-blue-500 transition-colors" />
              </Link>

              <Link href="/license-requests" className="flex items-center justify-between p-3 rounded-lg border border-zinc-200/80 hover:border-blue-200 hover:bg-blue-50/30 transition-all group">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-md bg-blue-50 text-blue-500 flex items-center justify-center shrink-0">
                    <UserCheck className="h-4 w-4" />
                  </div>
                  <span className="text-sm font-medium text-zinc-800">Review License Requests</span>
                </div>
                <ArrowRight className="h-4 w-4 text-zinc-300 group-hover:text-blue-500 transition-colors" />
              </Link>

              <Link href="/installations" className="flex items-center justify-between p-3 rounded-lg border border-zinc-200/80 hover:border-blue-200 hover:bg-blue-50/30 transition-all group">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-md bg-blue-50 text-blue-500 flex items-center justify-center shrink-0">
                    <Monitor className="h-4 w-4" />
                  </div>
                  <span className="text-sm font-medium text-zinc-800">View Installations</span>
                </div>
                <ArrowRight className="h-4 w-4 text-zinc-300 group-hover:text-blue-500 transition-colors" />
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
