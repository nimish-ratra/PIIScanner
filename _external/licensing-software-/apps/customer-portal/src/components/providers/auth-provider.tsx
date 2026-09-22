'use client';

/**
 * AuthProvider
 *
 * Manages the authenticated session state for the Customer Portal.
 *
 * Auth modes:
 *   password — Production. Login happens on the /login page via
 *              POST /customer/auth/login (email+password); this provider
 *              then calls /auth/me, which validates the resulting
 *              iron-session cookie and resolves the principal from the DB.
 *   e2e      — Automated tests only. Calls /auth/me which validates E2E_SESSION
 *              cookie. BLOCKED in production (see: API main.ts fail-fast).
 *
 * OIDC/SSO has been removed — there is no external identity provider in this
 * flow. Session data returned by /auth/me flows from the DB (via
 * IdentityService). The client NEVER holds or manages tokens or passwords.
 *
 * States:
 *   loading        — Initial fetch in progress. Renders a spinner.
 *   authenticated  — User is resolved. Renders children.
 *   unauthenticated — No valid session. Redirects to /login.
 *   error          — Configuration or unexpected error. Shows error boundary.
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { apiClient } from '@/lib/api-client';

export interface AuthenticatedPrincipal {
  id:               string;
  email:            string;
  roles:            string[];
  allowedCompanyIds: string[];
  isEnterpriseWide?: boolean;
  enterpriseId?:    string;
  companyId?:       string;
  // True while this account is still on a system-generated temporary
  // password (e.g. one a vendor issued when creating this customer).
  mustChangePassword?: boolean;
}

interface AuthContextType {
  user:                AuthenticatedPrincipal;
  selectedCompanyId:   string;
  setSelectedCompanyId:(id: string) => void;
  logout: () => Promise<void>;
  /** Re-fetches /auth/me — used after a password change to clear mustChangePassword locally. */
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [status, setStatus]   = useState<'loading' | 'authenticated' | 'unauthenticated' | 'error'>('loading');
  const [user, setUser]       = useState<AuthenticatedPrincipal | null>(null);
  const [selectedCompanyId, _setSelectedCompanyId] = useState<string>('*');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const setSelectedCompanyId = useCallback((id: string) => {
    _setSelectedCompanyId(id);
    // Persist selection in sessionStorage (not localStorage — cleared on tab close)
    try { sessionStorage.setItem('selected_company_id', id); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    const authMode = process.env.NEXT_PUBLIC_AUTH_MODE ?? 'password';

    // Login page: skip auth check entirely — render children immediately
    if (pathname === '/login' || pathname?.startsWith('/login')) {
      setStatus('authenticated');
      return;
    }

    // Hard block: e2e must never run in production builds
    if (authMode === 'e2e' && process.env.NODE_ENV === 'production') {
      setErrorMessage('E2E auth mode is not permitted in production.');
      setStatus('error');
      return;
    }

    if (authMode !== 'password' && authMode !== 'e2e') {
      setErrorMessage(`Unsupported NEXT_PUBLIC_AUTH_MODE="${authMode}". Expected "password" or "e2e".`);
      setStatus('error');
      return;
    }

    apiClient<AuthenticatedPrincipal>('/auth/me')
      .then((principal) => {
        setUser(principal);

        // Restore persisted company selection and validate it's still allowed
        let stored: string | null = null;
        try { stored = sessionStorage.getItem('selected_company_id'); } catch { /* ignore */ }

        const isEnterpriseAdmin = principal.isEnterpriseWide ?? false;
        if (stored && (isEnterpriseAdmin || principal.allowedCompanyIds.includes(stored))) {
          _setSelectedCompanyId(stored);
        } else if (!isEnterpriseAdmin && principal.allowedCompanyIds.length > 0) {
          _setSelectedCompanyId(principal.allowedCompanyIds[0]);
        } else {
          _setSelectedCompanyId('*');
        }

        setStatus('authenticated');
      })
      .catch((err: any) => {
        if (err?.status === 401) {
          // No valid session — middleware should have caught this,
          // but handle it gracefully in case of race conditions.
          setStatus('unauthenticated');
        } else {
          setErrorMessage(err?.message ?? 'Failed to load session. Please try again.');
          setStatus('error');
        }
      });
  }, []);

  // Redirect to login when unauthenticated (but only when NOT on /login already)
  useEffect(() => {
    if (status === 'unauthenticated' && pathname !== '/login' && !pathname?.startsWith('/login')) {
      router.replace('/login?error=session_expired');
    }
  }, [status, router, pathname]);

  // Force a password reset before anything else is usable — runs on every
  // navigation (not just once on mount), so it keeps redirecting back to
  // /settings until the change-password call actually clears the flag.
  useEffect(() => {
    if (status === 'authenticated' && user?.mustChangePassword && pathname !== '/settings') {
      router.replace('/settings?reason=must_change_password');
    }
  }, [status, user, router, pathname]);

  const refreshUser = useCallback(async () => {
    const principal = await apiClient<AuthenticatedPrincipal>('/auth/me');
    setUser(principal);
  }, []);

  const logout = useCallback(async () => {
    // There's no external IdP session to end anymore (OIDC removed) — just
    // destroy the local session and clear the cookie server-side, then
    // redirect. Previously this built a malformed URL (a doubled /api/v1
    // path segment) that 404'd silently, so the session cookie was never
    // actually cleared on logout — fixed by routing through apiClient.
    try {
      await apiClient('/auth/logout', { method: 'POST' });
    } catch {
      // Best-effort — still redirect even if the request failed (e.g. session
      // already expired server-side).
    } finally {
      window.location.href = '/login';
    }
  }, []);

  const isLoginPage = pathname === '/login' || pathname?.startsWith('/login');

  if (isLoginPage) {
    return (
      <AuthContext.Provider
        value={{
          user: user as any,
          selectedCompanyId,
          setSelectedCompanyId,
          logout,
          refreshUser,
        }}
      >
        {children}
      </AuthContext.Provider>
    );
  }

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-900" />
          <p className="text-sm text-slate-500">Loading session…</p>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 gap-4">
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 max-w-md text-center">
          <h2 className="text-lg font-semibold text-red-800 mb-2">Configuration Error</h2>
          <p className="text-sm text-red-600">{errorMessage ?? 'Authentication is misconfigured. Contact your administrator.'}</p>
        </div>
      </div>
    );
  }

  if (status === 'unauthenticated' || (!user && pathname !== '/login' && !pathname?.startsWith('/login'))) {
    // Rendering null while the redirect effect fires
    return null;
  }

  return (
    <AuthContext.Provider value={{ user: user as AuthenticatedPrincipal, selectedCompanyId, setSelectedCompanyId, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
