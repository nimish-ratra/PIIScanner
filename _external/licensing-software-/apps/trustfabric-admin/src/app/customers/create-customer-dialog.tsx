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
import { apiClient, ApiError } from '@/lib/api-client';
import type { Customer, CustomerCreated } from '@/lib/types';
import { Copy, Check, ShieldAlert } from 'lucide-react';

interface CreateCustomerDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (customer: Customer) => void;
}

export function CreateCustomerDialog({ isOpen, onOpenChange, onCreated }: CreateCustomerDialogProps) {
  const [name, setName] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CustomerCreated | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setName('');
      setAdminName('');
      setAdminEmail('');
      setError(null);
      setCreated(null);
      setCopied(false);
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError('Customer name is required.');
    if (!adminName.trim()) return setError('Admin name is required.');
    if (!adminEmail.trim()) return setError('Admin email is required.');

    setSubmitting(true);
    try {
      const customer = await apiClient<CustomerCreated>('/customers', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), adminName: adminName.trim(), adminEmail: adminEmail.trim() }),
      });
      setCreated(customer);
      onCreated(customer);
    } catch (err: any) {
      setError(err instanceof ApiError ? err.message : 'Failed to create customer.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopy = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.initialAdmin.temporaryPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable — the password is still selectable/visible in the field.
    }
  };

  const handleClose = () => onOpenChange(false);

  // ─── Success state: show the one-time credentials ───────────────────────
  if (created) {
    return (
      <Dialog open={isOpen} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Customer Created</DialogTitle>
            <DialogDescription>
              Copy this password now and hand it to the customer securely — it will not be shown
              again. There is no self-service password reset yet, so store it somewhere safe.
            </DialogDescription>
          </DialogHeader>

          <div className="py-2 space-y-3">
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-md p-3 text-xs text-amber-800">
              <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                The server stores only the Argon2id hash of this password — it cannot be recovered
                later, even by an administrator.
              </span>
            </div>

            <div className="space-y-1.5">
              <Label>Login email</Label>
              <Input readOnly value={created.initialAdmin.email} className="font-mono text-xs" />
            </div>

            <div className="space-y-1.5">
              <Label>Temporary password</Label>
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value={created.initialAdmin.temporaryPassword}
                  className="font-mono text-xs"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Button type="button" variant="outline" size="icon" onClick={handleCopy} title="Copy password">
                  {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" onClick={handleClose}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // ─── Form state ──────────────────────────────────────────────────────────
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !submitting && onOpenChange(open)}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Create Customer</DialogTitle>
          <DialogDescription>
            Creates the customer (enterprise) along with a default company and its first
            EnterpriseAdmin login — real credentials the customer can use immediately.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-2">
            {error && (
              <div className="bg-red-50 text-red-600 text-sm p-3 rounded-md border border-red-200">{error}</div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="cust-name">Customer name</Label>
              <Input
                id="cust-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Acme Corporation"
                disabled={submitting}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cust-admin-name">Admin name</Label>
              <Input
                id="cust-admin-name"
                value={adminName}
                onChange={(e) => setAdminName(e.target.value)}
                placeholder="e.g. Jordan Smith"
                disabled={submitting}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cust-admin-email">Admin email</Label>
              <Input
                id="cust-admin-email"
                type="email"
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
                placeholder="e.g. jordan@acme.com"
                disabled={submitting}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Creating...' : 'Create Customer'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
