'use client';

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { apiClient, ApiError } from '@/lib/api-client';
import type { Customer, Product, Edition, Entitlement } from '@/lib/types';

interface CreateEntitlementDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (entitlement: Entitlement) => void;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function oneYearFromTodayIso(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

export function CreateEntitlementDialog({ isOpen, onOpenChange, onCreated }: CreateEntitlementDialogProps) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [editions, setEditions] = useState<Edition[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);

  const [enterpriseId, setEnterpriseId] = useState('');
  const [productId, setProductId] = useState('');
  const [editionId, setEditionId] = useState('');
  const [quantity, setQuantity] = useState<number | ''>(100);
  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState(oneYearFromTodayIso());

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setEnterpriseId('');
    setProductId('');
    setEditionId('');
    setQuantity(100);
    setStartDate(todayIso());
    setEndDate(oneYearFromTodayIso());
    setError(null);

    setLoadingOptions(true);
    Promise.all([apiClient<Customer[]>('/customers'), apiClient<Product[]>('/products')])
      .then(([custRes, prodRes]) => {
        setCustomers(custRes.filter((c) => c.status === 'ACTIVE'));
        setProducts(prodRes.filter((p) => p.status === 'ACTIVE'));
      })
      .catch((err: any) => setError(err instanceof ApiError ? err.message : 'Failed to load options.'))
      .finally(() => setLoadingOptions(false));
  }, [isOpen]);

  useEffect(() => {
    setEditionId('');
    setEditions([]);
    if (!productId) return;
    apiClient<Product>(`/products/${productId}`)
      .then((p) => setEditions((p.editions ?? []).filter((e) => e.status === 'ACTIVE')))
      .catch(() => setEditions([]));
  }, [productId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!enterpriseId) return setError('Please select a customer.');
    if (!productId) return setError('Please select a product.');
    if (quantity === '' || quantity <= 0) return setError('Quantity must be a positive number.');
    if (!startDate || !endDate) return setError('Start and end dates are required.');
    if (new Date(startDate) > new Date(endDate)) return setError('Start date must not be after the end date.');

    setSubmitting(true);
    try {
      const entitlement = await apiClient<Entitlement>('/entitlements', {
        method: 'POST',
        body: JSON.stringify({
          enterpriseId,
          productId,
          editionId: editionId || undefined,
          quantity: Number(quantity),
          startDate,
          endDate,
        }),
      });
      onCreated(entitlement);
      onOpenChange(false);
    } catch (err: any) {
      setError(err instanceof ApiError ? err.message : 'Failed to create entitlement.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !submitting && onOpenChange(open)}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Create Entitlement</DialogTitle>
          <DialogDescription>
            Issues a commercial grant of seats to a customer. This creates one Entitlement record —
            not individual licenses.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-2">
            {error && (
              <div className="bg-red-50 text-red-600 text-sm p-3 rounded-md border border-red-200">{error}</div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="ent-customer">Customer</Label>
              <Select value={enterpriseId} onValueChange={(v) => setEnterpriseId(v ?? '')} disabled={submitting || loadingOptions}>
                <SelectTrigger id="ent-customer" className="w-full">
                  <SelectValue placeholder={loadingOptions ? 'Loading...' : 'Select a customer'} />
                </SelectTrigger>
                <SelectContent>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!loadingOptions && customers.length === 0 && (
                <p className="text-xs text-zinc-400">No active customers exist yet.</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ent-product">Product</Label>
              <Select value={productId} onValueChange={(v) => setProductId(v ?? '')} disabled={submitting || loadingOptions}>
                <SelectTrigger id="ent-product" className="w-full">
                  <SelectValue placeholder={loadingOptions ? 'Loading...' : 'Select a product'} />
                </SelectTrigger>
                <SelectContent>
                  {products.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!loadingOptions && products.length === 0 && (
                <p className="text-xs text-zinc-400">No active products exist yet.</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ent-edition">Edition (optional)</Label>
              <Select
                value={editionId}
                onValueChange={(v) => setEditionId(v ?? '')}
                disabled={submitting || !productId || editions.length === 0}
              >
                <SelectTrigger id="ent-edition" className="w-full">
                  <SelectValue
                    placeholder={
                      !productId ? 'Select a product first' : editions.length === 0 ? 'No editions for this product' : 'Product-level (no edition)'
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {editions.map((ed) => (
                    <SelectItem key={ed.id} value={ed.id}>
                      {ed.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ent-quantity">Quantity (seats)</Label>
              <Input
                id="ent-quantity"
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value ? Number(e.target.value) : '')}
                disabled={submitting}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="ent-start">Start date</Label>
                <Input
                  id="ent-start"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  disabled={submitting}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ent-end">Expiry date</Label>
                <Input
                  id="ent-end"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  disabled={submitting}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || loadingOptions}>
              {submitting ? 'Issuing...' : 'Create Entitlement'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
