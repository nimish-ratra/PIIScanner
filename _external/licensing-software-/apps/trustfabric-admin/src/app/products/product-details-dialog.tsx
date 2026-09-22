'use client';

import React, { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { LoadingState, ErrorState } from '@/components/ui/state';
import { apiClient, ApiError } from '@/lib/api-client';
import type { Product, Edition, Feature } from '@/lib/types';
import { Package, Layers, Sparkles, Plus, Pencil, Check, X } from 'lucide-react';
import { CreateEditionDialog } from './create-edition-dialog';
import { CreateFeatureDialog } from './create-feature-dialog';

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={status === 'ACTIVE' ? 'default' : 'secondary'} className="text-[10px]">
      {status}
    </Badge>
  );
}

export function ProductDetailsDialog({ productId, onClose }: { productId: string; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [product, setProduct] = useState<Product | null>(null);

  const [editingInfo, setEditingInfo] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [savingInfo, setSavingInfo] = useState(false);
  const [infoError, setInfoError] = useState<string | null>(null);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [addEditionOpen, setAddEditionOpen] = useState(false);
  const [addFeatureForEdition, setAddFeatureForEdition] = useState<string | null>(null);

  const loadProduct = React.useCallback(() => {
    setLoading(true);
    setError(null);
    apiClient<Product>(`/products/${productId}`)
      .then((p) => {
        setProduct(p);
        setNameDraft(p.name);
        setDescriptionDraft(p.description ?? '');
      })
      .catch((err) => setError(err))
      .finally(() => setLoading(false));
  }, [productId]);

  useEffect(() => {
    loadProduct();
  }, [loadProduct]);

  const toggleProductStatus = async () => {
    if (!product) return;
    const nextStatus = product.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    setBusyId('product-status');
    try {
      await apiClient(`/products/${product.id}`, { method: 'PATCH', body: JSON.stringify({ status: nextStatus }) });
      loadProduct();
    } catch (err: any) {
      setError(err);
    } finally {
      setBusyId(null);
    }
  };

  const saveInfo = async () => {
    if (!product) return;
    setInfoError(null);
    if (!nameDraft.trim()) {
      setInfoError('Name cannot be empty.');
      return;
    }
    setSavingInfo(true);
    try {
      await apiClient(`/products/${product.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: nameDraft.trim(), description: descriptionDraft.trim() || null }),
      });
      setEditingInfo(false);
      loadProduct();
    } catch (err: any) {
      setInfoError(err instanceof ApiError ? err.message : 'Failed to save changes.');
    } finally {
      setSavingInfo(false);
    }
  };

  const toggleEditionStatus = async (edition: Edition) => {
    const nextStatus = edition.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    setBusyId(edition.id);
    try {
      await apiClient(`/editions/${edition.id}`, { method: 'PATCH', body: JSON.stringify({ status: nextStatus }) });
      loadProduct();
    } catch (err: any) {
      setError(err);
    } finally {
      setBusyId(null);
    }
  };

  const toggleFeatureStatus = async (feature: Feature) => {
    const nextStatus = feature.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    setBusyId(feature.id);
    try {
      await apiClient(`/features/${feature.id}`, { method: 'PATCH', body: JSON.stringify({ status: nextStatus }) });
      loadProduct();
    } catch (err: any) {
      setError(err);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold text-zinc-800 flex items-center gap-2">
            <Package className="h-4 w-4 text-zinc-400" />
            {product?.name ?? 'Product'}
          </DialogTitle>
          <DialogDescription className="text-xs text-zinc-400">
            Manage the commercial catalog for this product — editions and features.
          </DialogDescription>
        </DialogHeader>

        {loading && <LoadingState message="Loading product..." />}
        {error && <ErrorState error={error} onRetry={loadProduct} />}

        {product && (
          <div className="max-h-[65vh] overflow-y-auto pr-1 space-y-5">
            {/* Product info */}
            <div className="rounded-lg border border-zinc-200 p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">Product</span>
                <div className="flex items-center gap-2">
                  <StatusBadge status={product.status} />
                  {!editingInfo && (
                    <Button variant="ghost" size="icon-sm" onClick={() => setEditingInfo(true)} title="Edit">
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>

              {editingInfo ? (
                <div className="space-y-2">
                  {infoError && <p className="text-xs text-red-600">{infoError}</p>}
                  <Input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} disabled={savingInfo} />
                  <Textarea
                    value={descriptionDraft}
                    onChange={(e) => setDescriptionDraft(e.target.value)}
                    disabled={savingInfo}
                    rows={2}
                  />
                  <div className="flex gap-2 justify-end">
                    <Button variant="outline" size="sm" onClick={() => setEditingInfo(false)} disabled={savingInfo}>
                      <X className="h-3.5 w-3.5" /> Cancel
                    </Button>
                    <Button size="sm" onClick={saveInfo} disabled={savingInfo}>
                      <Check className="h-3.5 w-3.5" /> {savingInfo ? 'Saving...' : 'Save'}
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-xs text-zinc-600">{product.description || 'No description.'}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={toggleProductStatus}
                    disabled={busyId === 'product-status'}
                  >
                    {product.status === 'ACTIVE' ? 'Disable Product' : 'Enable Product'}
                  </Button>
                </>
              )}
            </div>

            {/* Editions */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Layers className="h-3.5 w-3.5" /> Editions ({product.editions?.length ?? 0})
                </span>
                <Button variant="outline" size="sm" onClick={() => setAddEditionOpen(true)}>
                  <Plus className="h-3.5 w-3.5" /> Add Edition
                </Button>
              </div>

              {!product.editions || product.editions.length === 0 ? (
                <p className="text-xs text-zinc-400 py-3 text-center border border-dashed border-zinc-200 rounded-lg">
                  No editions yet. Entitlements for this product will be product-level only.
                </p>
              ) : (
                <div className="space-y-3">
                  {product.editions.map((edition) => (
                    <div key={edition.id} className="rounded-lg border border-zinc-200 p-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-xs font-semibold text-zinc-800">{edition.name}</div>
                          {edition.description && (
                            <div className="text-xs text-zinc-500 mt-0.5">{edition.description}</div>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <StatusBadge status={edition.status} />
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleEditionStatus(edition)}
                            disabled={busyId === edition.id}
                          >
                            {edition.status === 'ACTIVE' ? 'Disable' : 'Enable'}
                          </Button>
                        </div>
                      </div>

                      <div className="mt-3 pl-3 border-l-2 border-zinc-100">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                            <Sparkles className="h-3 w-3" /> Features ({edition.features?.length ?? 0})
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 text-xs"
                            onClick={() => setAddFeatureForEdition(edition.id)}
                          >
                            <Plus className="h-3 w-3" /> Add Feature
                          </Button>
                        </div>
                        {!edition.features || edition.features.length === 0 ? (
                          <p className="text-xs text-zinc-400 py-1">No features yet.</p>
                        ) : (
                          <ul className="space-y-1">
                            {edition.features.map((feature) => (
                              <li key={feature.id} className="flex items-center justify-between text-xs py-1">
                                <div>
                                  <span className="font-medium text-zinc-700">{feature.name}</span>{' '}
                                  <code className="text-[10px] text-zinc-400">{feature.key}</code>
                                </div>
                                <div className="flex items-center gap-2">
                                  <StatusBadge status={feature.status} />
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 text-xs"
                                    onClick={() => toggleFeatureStatus(feature)}
                                    disabled={busyId === feature.id}
                                  >
                                    {feature.status === 'ACTIVE' ? 'Disable' : 'Enable'}
                                  </Button>
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>

      {product && (
        <CreateEditionDialog
          isOpen={addEditionOpen}
          onOpenChange={setAddEditionOpen}
          productId={product.id}
          onCreated={loadProduct}
        />
      )}
      {addFeatureForEdition && (
        <CreateFeatureDialog
          isOpen
          onOpenChange={(open) => !open && setAddFeatureForEdition(null)}
          editionId={addFeatureForEdition}
          onCreated={() => {
            setAddFeatureForEdition(null);
            loadProduct();
          }}
        />
      )}
    </Dialog>
  );
}
