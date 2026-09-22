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
import type { Feature } from '@/lib/types';

interface CreateFeatureDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  editionId: string;
  onCreated: (feature: Feature) => void;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function CreateFeatureDialog({ isOpen, onOpenChange, editionId, onCreated }: CreateFeatureDialogProps) {
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [keyTouched, setKeyTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setName('');
      setKey('');
      setKeyTouched(false);
      setError(null);
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError('Feature name is required.');
      return;
    }
    if (!key.trim()) {
      setError('Feature key is required.');
      return;
    }
    setSubmitting(true);
    try {
      const feature = await apiClient<Feature>(`/editions/${editionId}/features`, {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), key: key.trim() }),
      });
      onCreated(feature);
      onOpenChange(false);
    } catch (err: any) {
      setError(err instanceof ApiError ? err.message : 'Failed to create feature.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !submitting && onOpenChange(open)}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Add Feature</DialogTitle>
          <DialogDescription>The key is the stable identifier the software checks at runtime.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-2">
            {error && (
              <div className="bg-red-50 text-red-600 text-sm p-3 rounded-md border border-red-200">{error}</div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="feat-name">Feature name</Label>
              <Input
                id="feat-name"
                value={name}
                onChange={(e) => {
                  const value = e.target.value;
                  setName(value);
                  if (!keyTouched) setKey(slugify(value));
                }}
                placeholder="e.g. Advanced Reporting"
                disabled={submitting}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="feat-key">Key</Label>
              <Input
                id="feat-key"
                value={key}
                onChange={(e) => {
                  setKey(e.target.value);
                  setKeyTouched(true);
                }}
                placeholder="e.g. advanced_reporting"
                className="font-mono text-xs"
                disabled={submitting}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Adding...' : 'Add Feature'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
