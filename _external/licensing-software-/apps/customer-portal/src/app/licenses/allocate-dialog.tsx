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
import { Entitlement, Company, LicenseAllocation } from '@/lib/types';

interface AllocateDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  entitlement: Entitlement | null;
  onSuccess: (allocation: LicenseAllocation) => void;
}

export function AllocateDialog({
  isOpen,
  onOpenChange,
  entitlement,
  onSuccess,
}: AllocateDialogProps) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loadingCompanies, setLoadingCompanies] = useState(false);
  
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [quantity, setQuantity] = useState<number | ''>('');
  
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && entitlement) {
      setLoadingCompanies(true);
      apiClient<Company[]>('/companies')
        .then((res) => setCompanies(res))
        .catch(() => setError('Failed to load companies'))
        .finally(() => setLoadingCompanies(false));
    }
  }, [isOpen, entitlement]);

  // Reset state when opened/closed
  useEffect(() => {
    if (isOpen) {
      setSelectedCompanyId('');
      setQuantity('');
      setError(null);
    }
  }, [isOpen]);

  if (!entitlement) return null;

  const available = entitlement.quantity - entitlement.allocatedQuantity;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    
    if (!selectedCompanyId) {
      setError('Please select a company.');
      return;
    }
    
    const qty = Number(quantity);
    if (!qty || qty <= 0) {
      setError('Quantity must be a positive number.');
      return;
    }
    
    if (qty > available) {
      setError(`Cannot exceed available quantity (${available}).`);
      return;
    }

    setSubmitting(true);
    try {
      const created = await apiClient<LicenseAllocation>('/licenses/allocate', {
        method: 'POST',
        body: JSON.stringify({
          entitlementId: entitlement.id,
          companyId: selectedCompanyId,
          quantity: qty,
        }),
      });
      onSuccess(created);
      onOpenChange(false);
    } catch (err: any) {
      setError(err.message || 'Failed to allocate licenses');
      if (err instanceof ApiError && err.data && typeof err.data === 'object') {
         const errorData = err.data as any;
         if (errorData.message) {
            setError(Array.isArray(errorData.message) ? errorData.message.join(', ') : errorData.message);
         }
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Allocate Licenses</DialogTitle>
          <DialogDescription>
            Assign seats from {entitlement.product?.name || entitlement.productId} to a company.
            You have {available} seats available to allocate.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            {error && (
              <div className="bg-red-50 text-red-600 text-sm p-3 rounded-md border border-red-200">
                {error}
              </div>
            )}
            
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="company" className="text-right">
                Company
              </Label>
              <div className="col-span-3">
                <Select
                  value={selectedCompanyId}
                  onValueChange={(v) => setSelectedCompanyId(v ?? '')}
                  disabled={loadingCompanies || submitting}
                >
                  <SelectTrigger id="company">
                    <SelectValue placeholder={loadingCompanies ? "Loading..." : "Select a company"} />
                  </SelectTrigger>
                  <SelectContent>
                    {companies.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} ({c.id})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="quantity" className="text-right">
                Quantity
              </Label>
              <Input
                id="quantity"
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value ? Number(e.target.value) : '')}
                className="col-span-3"
                disabled={submitting}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Allocating...' : 'Allocate'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
