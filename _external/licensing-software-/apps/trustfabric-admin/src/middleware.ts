/**
 * Next.js Middleware — Route Protection
 *
 * This middleware runs on the edge for all matched routes.
 * It provides a UX-layer redirect to /login for unauthenticated users.
 *
 * IMPORTANT: This is NOT the authorization layer. Backend guards remain
 * authoritative. This middleware only improves user experience by redirecting
 * to the login page before a blank/error screen is shown.
 *
 * Checks for the TF_VENDOR_SESSION cookie, set by POST /vendor/auth/login —
 * deliberately NOT the same cookie name as the Customer Portal's TF_SESSION,
 * so a browser logged into both portals doesn't have one session clobber the
 * other (see apps/api/src/auth/session.service.ts). E2E_SESSION is also
 * accepted in dev/test, matching the backend's own dev/test override.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/** Routes that do not require authentication */
const PUBLIC_PATHS = ['/login'];

const VENDOR_SESSION_COOKIE_NAME = process.env.VENDOR_SESSION_COOKIE_NAME ?? 'TF_VENDOR_SESSION';
const E2E_SESSION_COOKIE = 'E2E_SESSION';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths through
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Allow Next.js internals and static files through
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.includes('.') // static assets
  ) {
    return NextResponse.next();
  }

  const isDevOrTest = process.env.NODE_ENV !== 'production';

  const hasSession =
    !!request.cookies.get(VENDOR_SESSION_COOKIE_NAME)?.value ||
    (isDevOrTest && !!request.cookies.get(E2E_SESSION_COOKIE)?.value);

  if (!hasSession) {
    const loginUrl = new URL('/login', request.url);
    // Preserve the intended destination for post-login redirect
    loginUrl.searchParams.set('redirectTo', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths EXCEPT:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
