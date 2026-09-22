'use client';

import React, { useEffect, useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/state';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/components/providers/auth-provider';
import { LicenseAllocation, Entitlement, Company } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { ShieldAlert, Layers } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AllocateDialog } from './allocate-dialog';
import { EnrollmentTokensPanel } from './enrollment-tokens-panel';
import { AllocationDetailsDialog } from './allocation-details-dialog';

export default function LicensesPage() {
  const { selectedCompanyId, user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [allocations, setAllocations] = useState<LicenseAllocation[]>([]);
  const [entitlements, setEntitlements] = useState<Entitlement[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [summary, setSummary] = useState<any>(null);

  const [allocateOpen, setAllocateOpen] = useState(false);
  const [selectedEntitlement, setSelectedEntitlement] = useState<Entitlement | null>(null);
  const [selectedAllocation, setSelectedAllocation] = useState<LicenseAllocation | null>(null);
  // Set right after a successful Allocate, to auto-open the bulk/CSV
  // enrollment-token flow pre-scoped to the batch that was just created.
  const [pendingTokenAllocation, setPendingTokenAllocation] = useState<LicenseAllocation | null>(null);

  const isEnterpriseScope = selectedCompanyId === '*';
  const canManageEnrollment = user.roles.includes('EnterpriseAdmin') || user.roles.includes('CompanyAdmin');

  const [activeTab, setActiveTab] = useState(isEnterpriseScope ? 'entitlements' : 'allocations');
  useEffect(() => {
    setActiveTab(isEnterpriseScope ? 'entitlements' : 'allocations');
  }, [isEnterpriseScope]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const queryParams = new URLSearchParams();
      if (!isEnterpriseScope) {
        queryParams.append('companyId', selectedCompanyId);
      }
      
      const [resAlloc, resSummary, resCompanies] = await Promise.all([
        apiClient<LicenseAllocation[]>(`/licenses?${queryParams.toString()}`),
        apiClient<any>('/licenses/summary'),
        // Only CompanyAdmin/EnterpriseAdmin hold company.read — a plain User's
        // 403 here must not take down the rest of the page.
        apiClient<Company[]>('/companies').catch(() => [] as Company[]),
      ]);

      setAllocations(resAlloc);
      setSummary(resSummary);
      setCompanies(resCompanies);

      if (isEnterpriseScope) {
        const entRes = await apiClient<Entitlement[]>('/entitlements');
        setEntitlements(entRes);
      }
    } catch (err: any) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [selectedCompanyId, user]);

  const totalEntitled = summary?.totalEntitled || 0;
  const totalAllocated = summary?.totalAllocated || 0;
  const availableToAllocate = totalEntitled - totalAllocated;

  return (
    <div>
      <PageHeader
        title="Licenses"
        description="Manage entitlements, company allocations, and consumption"
      />

      {/* loading/error are rendered inline rather than as early returns — a
          background refresh (e.g. AllocationDetailsDialog's onChanged after a
          successful suspend/reactivate/revoke) must never unmount that
          dialog, or AllocateDialog, while either is open. */}
      {loading ? (
        <LoadingState message="Loading licensing data..." />
      ) : error ? (
        <ErrorState error={error} onRetry={loadData} />
      ) : (
        <>
      {/* Summary Section */}
      <div className="grid gap-4 md:grid-cols-3 mb-8">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Entitled Seats</CardTitle>
            <ShieldAlert className="h-4 w-4 text-slate-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalEntitled}</div>
            <p className="text-xs text-slate-500 mt-1">Purchased / Granted</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Allocated Seats</CardTitle>
            <Layers className="h-4 w-4 text-slate-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalAllocated}</div>
            <p className="text-xs text-slate-500 mt-1">Assigned to companies</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Available Seats</CardTitle>
            <ShieldAlert className="h-4 w-4 text-slate-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">{availableToAllocate}</div>
            <p className="text-xs text-slate-500 mt-1">Ready to be allocated</p>
          </CardContent>
        </Card>
      </div>

      {/* Controlled (not defaultValue) so allocating a new batch can jump the
          user straight to Enrollment Tokens — the scope-change effect above
          handles resetting the tab when switching between "All Companies"
          and a specific company. */}
      <Tabs value={activeTab} onValueChange={(v) => v && setActiveTab(v)} className="w-full">
        <TabsList className="mb-6 bg-slate-100 p-1">
          {isEnterpriseScope && <TabsTrigger value="entitlements">Entitlements (Enterprise)</TabsTrigger>}
          <TabsTrigger value="allocations">Allocations</TabsTrigger>
          <TabsTrigger value="consumption">Consumption</TabsTrigger>
          <TabsTrigger value="enrollment-tokens">Enrollment Tokens</TabsTrigger>
        </TabsList>
        
        {isEnterpriseScope && (
          <TabsContent value="entitlements">
            {entitlements.length === 0 ? (
              <EmptyState 
                title="No Entitlements Found" 
                description="Your enterprise does not currently have any active commercial entitlements."
              />
            ) : (
              <div className="rounded-md border bg-white shadow-sm overflow-x-auto">
                <Table>
                  <TableHeader className="bg-slate-50">
                    <TableRow>
                      <TableHead>Status</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead>Total Seats</TableHead>
                      <TableHead>Allocated</TableHead>
                      <TableHead>Available</TableHead>
                      <TableHead>Expiration</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entitlements.map((ent) => {
                      const available = ent.quantity - ent.allocatedQuantity;
                      return (
                        <TableRow key={ent.id}>
                          <TableCell>
                            <Badge variant="outline" className={ent.status === 'ACTIVE' ? "bg-green-50 text-green-700 border-green-200" : ""}>
                              {ent.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-medium">{ent.product?.name || ent.productId}</TableCell>
                          <TableCell>{ent.quantity}</TableCell>
                          <TableCell>{ent.allocatedQuantity}</TableCell>
                          <TableCell className="font-bold text-blue-600">{available}</TableCell>
                          <TableCell className="text-slate-500 text-sm">
                            {new Date(ent.endDate).toLocaleDateString()}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button 
                              variant="outline" 
                              size="sm" 
                              className="h-8"
                              disabled={ent.status !== 'ACTIVE' || available <= 0}
                              onClick={() => {
                                setSelectedEntitlement(ent);
                                setAllocateOpen(true);
                              }}
                            >
                              Allocate
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>
        )}

        <TabsContent value="allocations">
          {allocations.length === 0 ? (
            <EmptyState 
              title="No Allocations Found" 
              description="There are currently no license allocations matching your context."
            />
          ) : (
            <div className="rounded-md border bg-white shadow-sm overflow-x-auto">
              <Table>
                <TableHeader className="bg-slate-50">
                  <TableRow>
                    <TableHead>Status</TableHead>
                    <TableHead>Allocation ID</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Seats</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {allocations.map((alloc) => (
                    <TableRow key={alloc.id}>
                      <TableCell>
                        <Badge variant="outline" className={alloc.status === 'ACTIVE' || alloc.status === 'ALLOCATED' ? "bg-green-50 text-green-700 border-green-200" : ""}>
                          {alloc.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-slate-500">{alloc.id.slice(0,8)}...</TableCell>
                      <TableCell className="font-medium">{alloc.company?.name || alloc.companyId}</TableCell>
                      <TableCell>{alloc.entitlement?.productId || 'Unknown'}</TableCell>
                      <TableCell className="font-bold">{alloc.quantity}</TableCell>
                      <TableCell className="text-slate-500 text-sm">
                        {new Date(alloc.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="outline" size="sm" className="h-8" onClick={() => setSelectedAllocation(alloc)}>Manage</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
        
        <TabsContent value="consumption">
          {allocations.length === 0 ? (
            <EmptyState
              title="No Allocations Found"
              description="Consumption is tracked per allocation — there are none in this context yet."
            />
          ) : (
            <div className="rounded-md border bg-white shadow-sm overflow-x-auto">
              <Table>
                <TableHeader className="bg-slate-50">
                  <TableRow>
                    <TableHead>Company</TableHead>
                    <TableHead>Allocation ID</TableHead>
                    <TableHead>Allocated</TableHead>
                    <TableHead>Consumed</TableHead>
                    <TableHead>Available</TableHead>
                    <TableHead>Utilization</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {allocations.map((alloc) => {
                    const available = alloc.quantity - alloc.consumedQuantity;
                    const pct = alloc.quantity > 0 ? Math.round((alloc.consumedQuantity / alloc.quantity) * 100) : 0;
                    return (
                      <TableRow key={alloc.id}>
                        <TableCell className="font-medium">{alloc.company?.name || alloc.companyId}</TableCell>
                        <TableCell className="font-mono text-xs text-slate-500">{alloc.id.slice(0, 8)}...</TableCell>
                        <TableCell className="font-bold">{alloc.quantity}</TableCell>
                        <TableCell>{alloc.consumedQuantity}</TableCell>
                        <TableCell className="font-bold text-blue-600">{available}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-20 bg-slate-100 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${pct > 90 ? 'bg-amber-500' : 'bg-blue-500'}`}
                                style={{ width: `${Math.min(pct, 100)}%` }}
                              />
                            </div>
                            <span className="text-xs text-slate-500 tabular-nums">{pct}%</span>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="enrollment-tokens">
          <EnrollmentTokensPanel
            companies={companies}
            allocations={allocations}
            scopeCompanyId={selectedCompanyId}
            canManage={canManageEnrollment}
            pendingAllocation={pendingTokenAllocation}
            onPendingAllocationHandled={() => setPendingTokenAllocation(null)}
          />
        </TabsContent>
      </Tabs>

      <AllocateDialog
        isOpen={allocateOpen}
        onOpenChange={setAllocateOpen}
        entitlement={selectedEntitlement}
        onSuccess={async (newAllocation) => {
          // Wait for the refetch so the new allocation is already present in
          // `allocations` by the time EnrollmentTokensPanel's dialog opens —
          // it filters by companyId from that prop, not from newAllocation.
          await loadData();
          setActiveTab('enrollment-tokens');
          setPendingTokenAllocation(newAllocation);
        }}
      />

      {selectedAllocation && (
        <AllocationDetailsDialog
          allocation={selectedAllocation}
          canManage={canManageEnrollment}
          onClose={() => setSelectedAllocation(null)}
          onChanged={loadData}
        />
      )}
        </>
      )}
    </div>
  );
}
