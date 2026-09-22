'use client';

import React, { useEffect, useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { LoadingState, ErrorState } from '@/components/ui/state';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/components/providers/auth-provider';
import { Entitlement, Installation, Customer, Product } from '@/lib/types';
import { deriveCustomers } from '@/lib/derive';
import { ShieldCheck, Users, Key, MonitorCheck, Building2 } from 'lucide-react';
import Link from 'next/link';

/**
 * All metrics here come directly from real vendor endpoints — entitlements,
 * installations, customers, and products. "Top Customers by Entitled Seats"
 * is grouped client-side from real entitlement data (see lib/derive.ts).
 * There are no trend indicators, growth percentages, or health scores here —
 * none of that data is backed by any real API.
 */
export default function OverviewPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const [entitlements, setEntitlements] = useState<Entitlement[]>([]);
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [customersList, setCustomersList] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        setError(null);

        const [entRes, instRes, custRes, prodRes] = await Promise.all([
          apiClient<Entitlement[]>('/entitlements'),
          apiClient<Installation[]>('/installations'),
          apiClient<Customer[]>('/customers'),
          apiClient<Product[]>('/products'),
        ]);

        setEntitlements(entRes);
        setInstallations(instRes);
        setCustomersList(custRes);
        setProducts(prodRes);
      } catch (err: any) {
        setError(err);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [user]);

  if (loading) return <LoadingState message="Loading global metrics..." />;
  if (error) return <ErrorState error={error} />;

  const totalEntitled = entitlements.reduce((sum, e) => sum + e.quantity, 0);
  const totalAllocated = entitlements.reduce((sum, e) => sum + e.allocatedQuantity, 0);
  const totalAvailable = totalEntitled - totalAllocated;
  // Grouped from real entitlement data — used for the "top customers" ranking below.
  const customers = deriveCustomers(entitlements);
  const activeInstallations = installations.filter((i) => i.status === 'ACTIVE').length;

  const stats = [
    { label: 'Customers', value: customersList.length, sub: `${products.length} product${products.length === 1 ? '' : 's'} in catalog`, icon: Building2, color: 'indigo', href: '/customers' },
    { label: 'Total Entitled Seats', value: totalEntitled, sub: 'Across all products', icon: ShieldCheck, color: 'blue', href: '/entitlements' },
    { label: 'Allocated Seats', value: totalAllocated, sub: 'Assigned to customer companies', icon: Users, color: 'emerald', href: '/entitlements' },
    { label: 'Available Capacity', value: totalAvailable, sub: 'Entitled but not yet allocated', icon: Key, color: 'amber', href: '/entitlements' },
    { label: 'Active Installations', value: activeInstallations, sub: `of ${installations.length} total`, icon: MonitorCheck, color: 'purple', href: '/installations' },
  ];

  const bgColors: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    indigo: 'bg-indigo-50 text-indigo-600',
    purple: 'bg-purple-50 text-purple-600',
  };

  return (
    <div className="max-w-[1400px] mx-auto pb-12">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6">
        <PageHeader
          title="Overview"
          description="Global customer, licensing, and installation operations"
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5 mb-8">
        {stats.map((s) => (
          <Link
            key={s.label}
            href={s.href}
            className="bg-white rounded-xl border border-zinc-200 p-5 shadow-sm hover:border-zinc-300 hover:shadow-md transition-all"
          >
            <div className="flex items-center gap-3 mb-3">
              <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${bgColors[s.color]}`}>
                <s.icon className="h-4 w-4" />
              </div>
              <h3 className="text-sm font-medium text-zinc-600">{s.label}</h3>
            </div>
            <div className="text-3xl font-bold text-zinc-900 tabular-nums">{s.value.toLocaleString()}</div>
            <p className="text-xs text-zinc-500 mt-2">{s.sub}</p>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden shadow-sm">
          <div className="px-5 py-4 border-b border-zinc-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-900">Top Customers by Entitled Seats</h2>
            <Link href="/customers" className="text-xs font-medium text-blue-600 hover:text-blue-700">
              View all
            </Link>
          </div>
          {customers.length === 0 ? (
            <div className="p-8 text-center text-sm text-zinc-500">No entitlements provisioned yet.</div>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {[...customers]
                  .sort((a, b) => b.totalEntitled - a.totalEntitled)
                  .slice(0, 5)
                  .map((c) => (
                    <tr key={c.enterpriseId} className="border-b border-zinc-50 last:border-0">
                      <td className="px-5 py-3 font-medium text-zinc-800">{c.enterpriseName}</td>
                      <td className="px-5 py-3 text-zinc-500 text-xs">{c.entitlementCount} entitlement{c.entitlementCount !== 1 ? 's' : ''}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-zinc-700">{c.totalEntitled.toLocaleString()} seats</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden shadow-sm">
          <div className="px-5 py-4 border-b border-zinc-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-900">Entitlements Nearing Capacity</h2>
            <Link href="/entitlements" className="text-xs font-medium text-blue-600 hover:text-blue-700">
              View all
            </Link>
          </div>
          {(() => {
            const nearCapacity = entitlements
              .filter((e) => e.quantity > 0 && e.allocatedQuantity / e.quantity >= 0.8)
              .sort((a, b) => b.allocatedQuantity / b.quantity - a.allocatedQuantity / a.quantity)
              .slice(0, 5);
            if (nearCapacity.length === 0) {
              return <div className="p-8 text-center text-sm text-zinc-500">No entitlements above 80% utilization.</div>;
            }
            return (
              <table className="w-full text-sm">
                <tbody>
                  {nearCapacity.map((e) => {
                    const pct = Math.round((e.allocatedQuantity / e.quantity) * 100);
                    return (
                      <tr key={e.id} className="border-b border-zinc-50 last:border-0">
                        <td className="px-5 py-3 font-medium text-zinc-800">{e.enterprise?.name ?? e.enterpriseId}</td>
                        <td className="px-5 py-3 text-zinc-500 text-xs">{e.product?.name ?? e.productId}</td>
                        <td className="px-5 py-3 text-right tabular-nums text-amber-600 font-medium">{pct}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
