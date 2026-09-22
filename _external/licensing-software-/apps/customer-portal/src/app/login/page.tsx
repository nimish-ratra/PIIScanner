'use client';

import React, { useState } from 'react';
import { apiClient, ApiError } from '@/lib/api-client';

import { useSearchParams } from 'next/navigation';

const ERROR_MESSAGES: Record<string, string> = {
  session_expired: 'Your session has expired. Please sign in again.',
};

function LoginForm() {
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get('redirectTo');
  const sessionErrorKey = searchParams.get('error');
  const urlEmail = searchParams.get('email') || '';
  const urlPassword = searchParams.get('password') || '';

  const [email, setEmail] = useState(urlEmail);
  const [password, setPassword] = useState(urlPassword);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(
    sessionErrorKey ? (ERROR_MESSAGES[sessionErrorKey] ?? null) : null,
  );

  const handleSubmit = async (e?: React.SyntheticEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    setError(null);
    setSubmitting(true);
    try {
      const emailEl = (typeof document !== 'undefined' ? document.getElementById('email') : null) as HTMLInputElement | null;
      const passEl = (typeof document !== 'undefined' ? document.getElementById('password') : null) as HTMLInputElement | null;
      const finalEmail = (emailEl?.value || email || urlEmail).trim();
      const finalPassword = passEl?.value || password || urlPassword;

      if (!finalEmail || !finalPassword) {
        setError('Please enter both your email and password.');
        setSubmitting(false);
        return;
      }

      console.log('[Login] Submitting credentials for:', finalEmail);
      const res = await apiClient('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: finalEmail, password: finalPassword }),
      });
      console.log('[Login] Success response:', res);
      const rawDest = redirectTo ? decodeURIComponent(redirectTo) : '/overview';
      const destination = rawDest.startsWith('/') ? rawDest : '/overview';
      console.log('[Login] Navigating to destination:', destination);
      window.location.href = destination;
    } catch (err: any) {
      console.error('[Login] Error caught during sign in:', err);
      setError(err instanceof ApiError ? err.message : (err?.message || 'Unable to sign in. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 rounded-full bg-blue-600/10 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 rounded-full bg-indigo-600/10 blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-md px-6">
        {/* Logo / branding */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-600 mb-5 shadow-lg shadow-blue-600/30">
            <svg className="w-9 h-9 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">
            Trustfabric
          </h1>
          <p className="mt-2 text-slate-400 text-sm">
            Customer Portal
          </p>
        </div>

        {/* Card */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-8 shadow-2xl backdrop-blur-sm">
          <h2 className="text-lg font-semibold text-white mb-1">
            Sign in
          </h2>
          <p className="text-sm text-slate-400 mb-8">
            Use your Trustfabric-issued customer admin credentials.
          </p>

          {error && (
            <div className="mb-6 flex items-start gap-3 bg-red-500/10 border border-red-500/20 rounded-xl p-4">
              <svg className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
              <p className="text-sm text-red-300">{error}</p>
            </div>
          )}

          <form
            action="javascript:void(0);"
            method="POST"
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleSubmit(e);
            }}
            className="space-y-5"
          >
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-slate-300 mb-1.5">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={submitting}
                className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-slate-500
                           focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
                           disabled:opacity-50 transition-all"
                placeholder="you@company.com"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-slate-300 mb-1.5">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    e.stopPropagation();
                    handleSubmit(e);
                  }
                }}
                disabled={submitting}
                className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-slate-500
                           focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
                           disabled:opacity-50 transition-all"
                placeholder="••••••••"
              />
            </div>

            <button
              id="btn-sign-in"
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleSubmit(e);
              }}
              disabled={submitting}
              className="w-full px-5 py-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 active:bg-blue-700
                         disabled:opacity-50 disabled:cursor-not-allowed
                         text-white font-semibold text-sm shadow-lg shadow-blue-600/20
                         transition-all duration-200"
            >
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          {/* Password reset is not implemented yet — no fake recovery flow. */}
        </div>

        {/* Footer */}
        <p className="mt-8 text-center text-xs text-slate-600">
          Need access? Contact your enterprise administrator.
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <React.Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-slate-900 text-white text-sm">
        Loading…
      </div>
    }>
      <LoginForm />
    </React.Suspense>
  );
}
