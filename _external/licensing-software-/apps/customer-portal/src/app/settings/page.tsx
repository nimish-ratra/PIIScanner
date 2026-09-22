'use client';

import React, { useState, useEffect } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useAuth } from '@/components/providers/auth-provider';
import { apiClient, ApiError } from '@/lib/api-client';
import { ShieldAlert, ShieldCheck, KeyRound, Check } from 'lucide-react';

interface SettingsPageProps {
  searchParams?: Promise<{ reason?: string }>;
}

export default function SettingsPage({ searchParams }: SettingsPageProps) {
  const { user, refreshUser, selectedCompanyId } = useAuth();
  const unwrappedParams = searchParams ? React.use(searchParams) : {};
  const forcedReset = unwrappedParams?.reason === 'must_change_password' || (user.mustChangePassword ?? false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const canViewSettings = user.roles.includes('EnterpriseAdmin') || user.roles.includes('CompanyAdmin');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (!currentPassword || !newPassword || !confirmPassword) {
      setError('All fields are required.');
      return;
    }
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }
    if (newPassword === currentPassword) {
      setError('New password must be different from your current password.');
      return;
    }

    setSubmitting(true);
    try {
      await apiClient('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      // Clears mustChangePassword locally so the forced-redirect in
      // AuthProvider stops sending the user back here.
      await refreshUser();
    } catch (err: any) {
      setError(err instanceof ApiError ? err.message : 'Failed to change password.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl">
      <PageHeader title="Settings" description="Manage your account security" />

      {forcedReset && (
        <div className="mb-6 flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg p-4">
          <ShieldAlert className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-800">You must set a new password to continue</p>
            <p className="text-sm text-amber-700 mt-0.5">
              Your account was created with a temporary system-generated password. Choose a permanent password
              below before using the rest of the portal.
            </p>
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4 text-slate-400" />
            Change Password
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4 max-w-sm">
            {error && (
              <div className="bg-red-50 text-red-600 text-sm p-3 rounded-md border border-red-200">{error}</div>
            )}
            {success && (
              <div className="flex items-center gap-2 bg-emerald-50 text-emerald-700 text-sm p-3 rounded-md border border-emerald-200">
                <Check className="h-4 w-4 shrink-0" />
                Password updated successfully.
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="current-password">Current password</Label>
              <Input
                id="current-password"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                disabled={submitting}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={submitting}
              />
              <p className="text-xs text-slate-400">At least 8 characters.</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="confirm-password">Confirm new password</Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={submitting}
              />
            </div>

            <Button id="btn-reset-password" type="submit" disabled={submitting}>
              {submitting ? 'Updating...' : 'Reset Password'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {canViewSettings && (
        <FleetReportingSettings
          selectedCompanyId={selectedCompanyId}
          allowedCompanyIds={user.allowedCompanyIds}
        />
      )}
    </div>
  );
}

function FleetReportingSettings({
  selectedCompanyId,
  allowedCompanyIds,
}: {
  selectedCompanyId: string;
  allowedCompanyIds: string[];
}) {
  const [companies, setCompanies] = useState<Array<{ id: string; name: string }>>([]);
  const [activeCompanyId, setActiveCompanyId] = useState<string>('');
  const [telemetryEnabled, setTelemetryEnabled] = useState(true);
  const [syncFullPaths, setSyncFullPaths] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  useEffect(() => {
    async function loadCompanies() {
      try {
        setLoading(true);
        setError(null);
        const res = await apiClient<Array<{ id: string; name: string; telemetryEnabled?: boolean; syncFullPaths?: boolean }>>(
          '/customer/companies'
        );
        setCompanies(res);
        const targetId =
          selectedCompanyId !== '*' && selectedCompanyId
            ? selectedCompanyId
            : res[0]?.id || '';
        setActiveCompanyId(targetId);

        const target = res.find((c) => c.id === targetId);
        if (target) {
          setTelemetryEnabled(target.telemetryEnabled ?? true);
          setSyncFullPaths(target.syncFullPaths ?? false);
        }
      } catch (err: any) {
        setError(err instanceof ApiError ? err.message : 'Failed to load company settings.');
      } finally {
        setLoading(false);
      }
    }
    loadCompanies();
  }, [selectedCompanyId]);

  const handleCompanyChange = async (compId: string) => {
    setActiveCompanyId(compId);
    setError(null);
    setSuccess(false);
    try {
      const comp = await apiClient<{ telemetryEnabled?: boolean; syncFullPaths?: boolean }>(
        `/customer/companies/${compId}`
      );
      setTelemetryEnabled(comp.telemetryEnabled ?? true);
      setSyncFullPaths(comp.syncFullPaths ?? false);
    } catch {
      // Keep defaults
    }
  };

  const handleToggleFullPaths = () => {
    if (!syncFullPaths) {
      setShowConfirmModal(true);
    } else {
      setSyncFullPaths(false);
    }
  };

  const handleSave = async () => {
    if (!activeCompanyId) return;
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      await apiClient(`/customer/companies/${activeCompanyId}/telemetry-settings`, {
        method: 'PATCH',
        body: JSON.stringify({ telemetryEnabled, syncFullPaths }),
      });
      setSuccess(true);
    } catch (err: any) {
      setError(err instanceof ApiError ? err.message : 'Failed to update telemetry settings.');
    } finally {
      setSaving(false);
    }
  };

  if (loading && companies.length === 0) {
    return <div className="mt-6 text-xs text-zinc-400">Loading organization settings...</div>;
  }

  return (
    <>
      <Card className="mt-6 border border-zinc-200/80 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-blue-500" />
            Fleet Reporting & Telemetry Policy
          </CardTitle>
          <p className="text-xs text-zinc-500 mt-1">
            Configure operational telemetry and data visibility for ClAIssify endpoint agents across your organization.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          {error && (
            <div className="bg-red-50 text-red-600 text-xs p-3 rounded-md border border-red-200">{error}</div>
          )}
          {success && (
            <div className="flex items-center gap-2 bg-emerald-50 text-emerald-700 text-xs p-3 rounded-md border border-emerald-200">
              <Check className="h-4 w-4 shrink-0" />
              Fleet telemetry settings saved successfully. Agents will receive updated policy on their next ping.
            </div>
          )}

          {companies.length > 1 && (
            <div className="space-y-1.5 max-w-sm">
              <Label className="text-xs">Company Scope</Label>
              <select
                value={activeCompanyId}
                onChange={(e) => handleCompanyChange(e.target.value)}
                className="w-full text-xs border border-zinc-200 rounded-md p-2 bg-white"
              >
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Toggle 1: Telemetry Enabled */}
          <div className="flex items-start justify-between gap-4 p-3.5 bg-zinc-50 rounded-lg border border-zinc-200/70">
            <div className="space-y-0.5">
              <span className="text-xs font-semibold text-zinc-800">Enable Fleet Telemetry</span>
              <p className="text-xs text-zinc-500">
                Allows endpoint devices running ClAIssify to report service status, scan summaries, sensitivity tier counts, and real-time DLP enforcement windows. Zero file content or PII values ever leave the devices.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setTelemetryEnabled(!telemetryEnabled)}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                telemetryEnabled ? 'bg-blue-600' : 'bg-zinc-300'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  telemetryEnabled ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Toggle 2: Sync Full Paths */}
          <div className="flex items-start justify-between gap-4 p-3.5 bg-zinc-50 rounded-lg border border-zinc-200/70">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-zinc-800">Share Literal File Paths</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-medium">
                  Sensitive
                </span>
              </div>
              <p className="text-xs text-zinc-500">
                When enabled, scan findings include literal filesystem paths (e.g.{' '}
                <code className="text-[11px] bg-zinc-200/70 px-1 rounded">C:\Documents\report.docx</code>) instead of
                salted cryptographic hashes (<code className="text-[11px] bg-zinc-200/70 px-1 rounded">sha256:...</code>). File content is never transmitted.
              </p>
            </div>
            <button
              type="button"
              onClick={handleToggleFullPaths}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                syncFullPaths ? 'bg-blue-600' : 'bg-zinc-300'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  syncFullPaths ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          <div className="flex justify-end pt-2">
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save Fleet Settings'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Confirmation Dialog for Enabling Literal Paths */}
      <Dialog open={showConfirmModal} onOpenChange={(open) => !open && setShowConfirmModal(false)}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm text-amber-700">
              <ShieldAlert className="h-4 w-4 text-amber-600" />
              Enable Literal File Paths?
            </DialogTitle>
            <DialogDescription className="text-xs text-zinc-600 space-y-2 mt-2">
              <p>
                File names and directory structures can themselves contain sensitive company projects, internal partner names, or personal identities.
              </p>
              <p>
                By default, ClAIssify reports one-way salted hashes (<code className="text-[11px] bg-zinc-100 p-0.5 rounded">sha256:...</code>) to preserve maximum confidentiality.
              </p>
              <p className="font-semibold text-zinc-800">
                Are you sure your organizational security policy permits transmitting plaintext file and directory paths to this portal?
              </p>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowConfirmModal(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setSyncFullPaths(true);
                setShowConfirmModal(false);
              }}
            >
              Confirm & Enable
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
