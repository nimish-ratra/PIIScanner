'use client';

/**
 * AuthProvider (Trustfabric Admin / Vendor Portal)
 *
 * Real backend-authenticated vendor login: POST /vendor/auth/login
 * (email+password, verified against VendorUser.passwordHash) establishes a
 * TF_VENDOR_SESSION cookie; this provider then calls GET /auth/me, which
 * validates that cookie and resolves the vendor principal fresh from the DB
 * (see apps/api/src/auth/identity.service.ts's resolveVendorPrincipalById).
 *
 * There is exactly one vendor role today (TrustfabricAdmin, permissions:
 * ['*']), so there is nothing to "switch" between — no company/customer
 * context switcher exists here by design.
 *
 * States:
 *   loading         — Initial /auth/me fetch in progress. Renders a spinner.
 *   authenticated   — Principal resolved. Renders children.
 *   unauthenticated — No valid session. Redirects to /login.
 *   error           — Unexpected error. Shows an error boundary.
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { apiClient } from '@/lib/api-client';

export interface UserIdentity {
  id: string;
  email: string;
  roles: string[];
  allowedCompanyIds: string[];
}

interface AuthContextType {
  user: UserIdentity;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [status, setStatus] = useState<'loading' | 'authenticated' | 'unauthenticated' | 'error'>('loading');
  const [user, setUser] = useState<UserIdentity | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    // Login page: skip the auth check entirely — render children immediately.
    if (pathname === '/login' || pathname?.startsWith('/login')) {
      setStatus('authenticated');
      return;
    }

    apiClient<UserIdentity>('/auth/me')
      .then((principal) => {
        setUser(principal);
        setStatus('authenticated');
      })
      .catch((err: any) => {
        if (err?.status === 401) {
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

  const logout = useCallback(async () => {
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
      <AuthContext.Provider value={{ user: user as UserIdentity, logout }}>
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
    <AuthContext.Provider value={{ user: user as UserIdentity, logout }}>
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
