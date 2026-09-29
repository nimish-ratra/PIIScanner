'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { apiClient, ApiError } from '@/lib/api-client';
import {
  Cloud,
  ExternalLink,
  RotateCw,
  Play,
  Check,
  AlertCircle,
  Shield,
  Info,
  Layers,
  Clock,
} from 'lucide-react';

interface O365ConnectorSettingsProps {
  activeCompanyId: string;
}

export function O365ConnectorSettings({ activeCompanyId }: O365ConnectorSettingsProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  // Form fields
  const [tenantId, setTenantId] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [hasClientSecret, setHasClientSecret] = useState(false);
  const [adminConsentGranted, setAdminConsentGranted] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [pollIntervalMinutes, setPollIntervalMinutes] = useState(5);
  const [dryRunMode, setDryRunMode] = useState(true);
  const [quarantineLibraryName, setQuarantineLibraryName] = useState('clAIssify-Quarantine');
  const [status, setStatus] = useState('NOT_CONFIGURED');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [syncStates, setSyncStates] = useState<any[]>([]);

  const loadConfig = useCallback(async () => {
    if (!activeCompanyId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient<{
        configured: boolean;
        config: any;
        syncStates: any[];
      }>(`/customer/companies/${activeCompanyId}/o365-connector`);

      if (res.config) {
        setTenantId(res.config.tenantId || '');
        setClientId(res.config.clientId || '');
        setHasClientSecret(res.config.hasClientSecret ?? false);
        setAdminConsentGranted(res.config.adminConsentGranted ?? false);
        setEnabled(res.config.enabled ?? true);
        setPollIntervalMinutes(res.config.pollIntervalMinutes ?? 5);
        setDryRunMode(res.config.dryRunMode ?? true);
        setQuarantineLibraryName(res.config.quarantineLibraryName || 'clAIssify-Quarantine');
        setStatus(res.config.status || 'CONFIGURED');
        setStatusMessage(res.config.statusMessage);
        setLastSyncAt(res.config.lastSyncAt);
      } else {
        setTenantId('');
        setClientId('');
        setHasClientSecret(false);
        setAdminConsentGranted(false);
        setEnabled(true);
        setPollIntervalMinutes(5);
        setDryRunMode(true);
        setQuarantineLibraryName('clAIssify-Quarantine');
        setStatus('NOT_CONFIGURED');
        setStatusMessage(null);
        setLastSyncAt(null);
      }
      setSyncStates(res.syncStates || []);
    } catch (err: any) {
      setError(err instanceof ApiError ? err.message : 'Failed to load O365 connector configuration.');
    } finally {
      setLoading(false);
    }
  }, [activeCompanyId]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId.trim() || !clientId.trim()) {
      setError('Azure AD Tenant ID and Client ID are required.');
      return;
    }
    if (!hasClientSecret && !clientSecret.trim()) {
      setError('Client Secret is required for initial configuration.');
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const payload: any = {
        tenantId: tenantId.trim(),
        clientId: clientId.trim(),
        adminConsentGranted,
        enabled,
        pollIntervalMinutes: Number(pollIntervalMinutes) || 5,
        dryRunMode,
        quarantineLibraryName: quarantineLibraryName.trim() || 'clAIssify-Quarantine',
      };
      if (clientSecret.trim()) {
        payload.clientSecret = clientSecret.trim();
      }

      await apiClient(`/customer/companies/${activeCompanyId}/o365-connector`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });

      setSuccess('O365 Cloud Connector configuration updated successfully.');
      setClientSecret('');
      await loadConfig();
    } catch (err: any) {
      setError(err instanceof ApiError ? err.message : 'Failed to save configuration.');
    } finally {
      setSaving(false);
    }
  };

  const handleTriggerSync = async () => {
    setSyncing(true);
    setSyncMessage(null);
    setError(null);
    try {
      const res = await apiClient<{ status: string; message?: string; result?: any }>(
        `/customer/companies/${activeCompanyId}/o365-connector/sync`,
        { method: 'POST' }
      );
      setSyncMessage(res.message || 'Sync initiated successfully. Check Fleet Telemetry for results.');
      await loadConfig();
    } catch (err: any) {
      setError(err instanceof ApiError ? err.message : 'Failed to trigger sync.');
    } finally {
      setSyncing(false);
    }
  };

  // Generate Admin Consent URL
  const consentUrl =
    tenantId.trim() && clientId.trim()
      ? `https://login.microsoftonline.com/${tenantId.trim()}/adminconsent?client_id=${clientId.trim()}&redirect_uri=${encodeURIComponent(
          typeof window !== 'undefined' ? window.location.origin + '/settings' : ''
        )}`
      : null;

  if (loading) {
    return <div className="mt-6 text-xs text-zinc-400">Loading Office 365 Connector settings...</div>;
  }

  return (
    <Card className="mt-6 border border-zinc-200/80 shadow-sm">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Cloud className="h-5 w-5 text-sky-500" />
            <CardTitle className="text-base">Office 365 & SharePoint Cloud Connector</CardTitle>
          </div>
          <Badge
            variant="outline"
            className={
              status === 'CONFIGURED'
                ? 'border-emerald-300 text-emerald-700 bg-emerald-50'
                : status === 'SYNCING'
                ? 'border-blue-300 text-blue-700 bg-blue-50'
                : status === 'PENDING_CONSENT'
                ? 'border-amber-300 text-amber-700 bg-amber-50'
                : 'border-zinc-300 text-zinc-600 bg-zinc-50'
            }
          >
            {status}
          </Badge>
        </div>
        <CardDescription className="text-xs text-zinc-500 mt-1">
          Centrally inspect SharePoint sites and OneDrive user drives using your Azure AD app registration.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Architecture & Caveat Callout */}
        <div className="flex items-start gap-3 bg-sky-50/70 border border-sky-200/80 rounded-lg p-3.5 text-xs text-sky-900">
          <Info className="h-4 w-4 text-sky-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <span className="font-semibold text-sky-950">Detect-and-Remediate Architecture</span>
            <p className="text-sky-800">
              O365 cloud data protection operates on a <strong>detect-and-remediate</strong> model (via Microsoft Graph delta synchronization), mirroring the Filesystem Watcher. Pre-save blocking is not supported for cloud uploads, as Microsoft Graph does not expose pre-commit cancel APIs for cloud co-authoring.
            </p>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 text-red-600 text-xs p-3 rounded-md border border-red-200 flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="bg-emerald-50 text-emerald-700 text-xs p-3 rounded-md border border-emerald-200 flex items-center gap-2">
            <Check className="h-4 w-4 shrink-0" />
            <span>{success}</span>
          </div>
        )}

        {syncMessage && (
          <div className="bg-blue-50 text-blue-700 text-xs p-3 rounded-md border border-blue-200 flex items-center gap-2">
            <Check className="h-4 w-4 shrink-0" />
            <span>{syncMessage}</span>
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-5">
          {/* Azure AD App Credentials */}
          <div className="space-y-4">
            <h4 className="text-xs font-semibold text-zinc-800 flex items-center gap-1.5 uppercase tracking-wider">
              <Shield className="h-3.5 w-3.5 text-zinc-500" />
              1. Azure AD App Registration (Entra ID)
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="tenantId" className="text-xs font-medium text-zinc-700">
                  Directory (Tenant) ID
                </Label>
                <Input
                  id="tenantId"
                  placeholder="e.g. 8f6b2c14-52a1-43e9-a35c-927bb12d8a4f"
                  value={tenantId}
                  onChange={(e) => setTenantId(e.target.value)}
                  className="font-mono text-xs"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="clientId" className="text-xs font-medium text-zinc-700">
                  Application (Client) ID
                </Label>
                <Input
                  id="clientId"
                  placeholder="e.g. d3b07384-d113-4019-90ec-944d18086054"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  className="font-mono text-xs"
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="clientSecret" className="text-xs font-medium text-zinc-700">
                Client Secret
              </Label>
              <Input
                id="clientSecret"
                type="password"
                placeholder={hasClientSecret ? '•••••••••••••••• (Encrypted at rest — leave blank to keep)' : 'Enter client secret value'}
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                className="font-mono text-xs"
              />
              <p className="text-[11px] text-zinc-400">
                Credentials are encrypted at rest using AES-256-GCM before storage.
              </p>
            </div>
          </div>

          {/* Admin Consent Step */}
          <div className="p-4 bg-zinc-50 rounded-lg border border-zinc-200/80 space-y-3">
            <h4 className="text-xs font-semibold text-zinc-800 flex items-center gap-1.5 uppercase tracking-wider">
              <ExternalLink className="h-3.5 w-3.5 text-zinc-500" />
              2. Tenant Admin Consent
            </h4>
            <p className="text-xs text-zinc-600">
              The registered application requires Microsoft Graph Application permissions:
              <code className="mx-1 px-1 py-0.5 bg-zinc-200/70 text-zinc-800 rounded text-[11px]">Sites.Read.All</code>,
              <code className="mr-1 px-1 py-0.5 bg-zinc-200/70 text-zinc-800 rounded text-[11px]">Files.Read.All</code>, and
              <code className="mr-1 px-1 py-0.5 bg-zinc-200/70 text-zinc-800 rounded text-[11px]">User.Read.All</code>.
              For write-back quarantine and watermarking, add <code className="px-1 py-0.5 bg-zinc-200/70 text-zinc-800 rounded text-[11px]">Sites.ReadWrite.All</code> and <code className="px-1 py-0.5 bg-zinc-200/70 text-zinc-800 rounded text-[11px]">Files.ReadWrite.All</code>.
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              {consentUrl ? (
                <a
                  href={consentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Grant Admin Consent in Microsoft Entra
                </a>
              ) : (
                <Button size="sm" variant="outline" disabled className="text-xs">
                  Enter Tenant ID & Client ID above to generate consent link
                </Button>
              )}

              <label className="flex items-center gap-2 cursor-pointer text-xs text-zinc-700 select-none">
                <input
                  type="checkbox"
                  checked={adminConsentGranted}
                  onChange={(e) => setAdminConsentGranted(e.target.checked)}
                  className="rounded border-zinc-300 text-blue-600 focus:ring-blue-500 h-4 w-4"
                />
                <span>Admin consent has been granted for this tenant</span>
              </label>
            </div>
          </div>

          {/* Polling & Safety Configuration */}
          <div className="space-y-4 pt-1">
            <h4 className="text-xs font-semibold text-zinc-800 flex items-center gap-1.5 uppercase tracking-wider">
              <Clock className="h-3.5 w-3.5 text-zinc-500" />
              3. Polling & Remediation Configuration
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="pollInterval" className="text-xs font-medium text-zinc-700">
                  Polling Interval (minutes)
                </Label>
                <Input
                  id="pollInterval"
                  type="number"
                  min={1}
                  max={60}
                  value={pollIntervalMinutes}
                  onChange={(e) => setPollIntervalMinutes(Number(e.target.value))}
                  className="text-xs"
                />
                <p className="text-[11px] text-zinc-400">
                  Runs Graph delta queries every 1–60 minutes.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="quarantineLib" className="text-xs font-medium text-zinc-700">
                  Quarantine Library / Folder Name
                </Label>
                <Input
                  id="quarantineLib"
                  value={quarantineLibraryName}
                  onChange={(e) => setQuarantineLibraryName(e.target.value)}
                  className="text-xs"
                />
                <p className="text-[11px] text-zinc-400">
                  Restricted folder for quarantined sensitive files.
                </p>
              </div>
            </div>

            {/* Dry-run Toggle */}
            <div className="flex items-start justify-between gap-4 p-3.5 bg-amber-50/60 rounded-lg border border-amber-200/70">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-zinc-800">Dry-Run Mode</span>
                  <Badge variant="outline" className="border-amber-300 text-amber-800 bg-amber-50 text-[10px]">
                    Recommended for Onboarding
                  </Badge>
                </div>
                <p className="text-xs text-zinc-600">
                  When enabled, files are classified and findings recorded, but no permission modifications or watermarks are written back to your SharePoint/OneDrive tenant.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDryRunMode(!dryRunMode)}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  dryRunMode ? 'bg-amber-600' : 'bg-zinc-300'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    dryRunMode ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Enable Connector Toggle */}
            <div className="flex items-start justify-between gap-4 p-3.5 bg-zinc-50 rounded-lg border border-zinc-200/70">
              <div className="space-y-0.5">
                <span className="text-xs font-semibold text-zinc-800">Enable Cloud Connector</span>
                <p className="text-xs text-zinc-500">
                  Actively polls for new and modified SharePoint / OneDrive documents.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEnabled(!enabled)}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  enabled ? 'bg-blue-600' : 'bg-zinc-300'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    enabled ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-zinc-200">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleTriggerSync}
                disabled={syncing || !hasClientSecret && !clientSecret}
                className="text-xs"
              >
                <Play className="h-3.5 w-3.5 mr-1 text-emerald-600" />
                {syncing ? 'Triggering...' : 'Trigger Sync Now'}
              </Button>
              {lastSyncAt && (
                <span className="text-[11px] text-zinc-400">
                  Last sync: {new Date(lastSyncAt).toLocaleString()}
                </span>
              )}
            </div>

            <Button type="submit" size="sm" disabled={saving} className="text-xs">
              {saving ? 'Saving...' : 'Save Configuration'}
            </Button>
          </div>
        </form>

        {/* Synced Resources / Delta State */}
        {syncStates.length > 0 && (
          <div className="space-y-2 pt-2">
            <h5 className="text-xs font-semibold text-zinc-700 flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5 text-zinc-500" />
              Active Delta Walk Cursors ({syncStates.length})
            </h5>
            <div className="max-h-40 overflow-y-auto border border-zinc-200 rounded-lg text-xs">
              <table className="w-full text-left">
                <thead className="bg-zinc-50 text-[10px] uppercase text-zinc-400 border-b border-zinc-200">
                  <tr>
                    <th className="p-2">Target Name</th>
                    <th className="p-2">Type</th>
                    <th className="p-2">Items Synced</th>
                    <th className="p-2">Last Delta Sync</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {syncStates.map((s) => (
                    <tr key={s.id} className="text-zinc-700 hover:bg-zinc-50/50">
                      <td className="p-2 font-medium truncate max-w-[200px]" title={s.targetName || s.targetId}>
                        {s.targetName || s.targetId}
                      </td>
                      <td className="p-2 text-zinc-500 capitalize">{s.targetType}</td>
                      <td className="p-2">{s.itemsProcessed ?? 0}</td>
                      <td className="p-2 text-zinc-400">
                        {s.lastSyncAt ? new Date(s.lastSyncAt).toLocaleString() : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
