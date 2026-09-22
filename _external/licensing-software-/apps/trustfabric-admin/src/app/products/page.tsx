'use client';

import React, { useEffect, useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/state';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/components/providers/auth-provider';
import type { Product } from '@/lib/types';
import { Package, ChevronRight, Plus, Search } from 'lucide-react';
import { CreateProductDialog } from './create-product-dialog';
import { ProductDetailsDialog } from './product-details-dialog';

type StatusFilter = 'ALL' | 'ACTIVE' | 'INACTIVE';

export default function ProductsPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const loadData = React.useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiClient<Product[]>('/products');
      setProducts(res);
    } catch (err: any) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData, user]);

  const filtered = products.filter((p) => {
    if (statusFilter !== 'ALL' && p.status !== statusFilter) return false;
    if (searchQuery && !p.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="max-w-[1400px] mx-auto pb-12 flex flex-col h-[calc(100vh-8rem)]">
      {/* loading/error/table are inline below (not an early `return`) so a
          background reload never unmounts CreateProductDialog/ProductDetailsDialog. */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 shrink-0">
        <PageHeader title="Products" description="Manage the commercial product catalog" />
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-3.5 w-3.5" /> Create Product
        </Button>
      </div>

      {loading ? (
        <LoadingState message="Loading products..." />
      ) : error ? (
        <ErrorState error={error} onRetry={loadData} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-4 shrink-0">
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
              <input
                type="text"
                placeholder="Search products..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow bg-white"
              />
            </div>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter((v ?? 'ALL') as StatusFilter)}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All statuses</SelectItem>
                <SelectItem value="ACTIVE">Active</SelectItem>
                <SelectItem value="INACTIVE">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="bg-white border border-zinc-200 rounded-xl flex flex-col flex-1 min-h-0 shadow-sm overflow-hidden">
            <div className="flex-1 overflow-auto bg-white">
              {products.length === 0 ? (
                <EmptyState title="No products yet" description="Create the first product in the commercial catalog." />
              ) : filtered.length === 0 ? (
                <div className="p-12 text-center text-zinc-500 text-sm">No products match your filters.</div>
              ) : (
                <Table>
                  <TableHeader className="bg-slate-50 sticky top-0 z-10 shadow-sm">
                    <TableRow>
                      <TableHead className="font-semibold">Product</TableHead>
                      <TableHead className="font-semibold">Editions</TableHead>
                      <TableHead className="font-semibold">Entitlements</TableHead>
                      <TableHead className="font-semibold">Status</TableHead>
                      <TableHead className="text-right"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((p) => (
                      <TableRow key={p.id} className="hover:bg-zinc-50/50 cursor-pointer" onClick={() => setSelectedId(p.id)}>
                        <TableCell>
                          <div className="font-medium text-zinc-900 flex items-center gap-2">
                            <Package className="h-4 w-4 text-zinc-400" />
                            {p.name}
                          </div>
                          {p.description && <div className="text-xs text-zinc-500 mt-0.5 ml-6">{p.description}</div>}
                        </TableCell>
                        <TableCell className="tabular-nums">{p._count?.editions ?? 0}</TableCell>
                        <TableCell className="tabular-nums">{p._count?.entitlements ?? 0}</TableCell>
                        <TableCell>
                          <Badge variant={p.status === 'ACTIVE' ? 'default' : 'secondary'}>{p.status}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <ChevronRight className="h-4 w-4 text-zinc-300 inline-block" />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </div>
        </>
      )}

      <CreateProductDialog
        isOpen={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(product) => {
          loadData();
          setSelectedId(product.id);
        }}
      />
      {selectedId && <ProductDetailsDialog productId={selectedId} onClose={() => { setSelectedId(null); loadData(); }} />}
    </div>
  );
}
