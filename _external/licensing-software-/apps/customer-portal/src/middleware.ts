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
 * Auth mode detection:
 *  - password: Check for the TF_SESSION (or SESSION_COOKIE_NAME) cookie,
 *              set by POST /customer/auth/login.
 *  - e2e:      Check for the E2E_SESSION cookie.
 *  - Neither → redirect to /login.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/** Routes that do not require authentication */
const PUBLIC_PATHS = ['/login'];

/** Cookie names — must match API config */
const SESSION_COOKIE_NAME  = process.env.SESSION_COOKIE_NAME  ?? 'TF_SESSION';
const E2E_SESSION_COOKIE   = 'E2E_SESSION';

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

  const authMode = process.env.NEXT_PUBLIC_AUTH_MODE ?? 'password';
  const isDevOrTest = process.env.NODE_ENV !== 'production';

  const hasSession =
    (authMode === 'e2e' ? !!request.cookies.get(E2E_SESSION_COOKIE)?.value : !!request.cookies.get(SESSION_COOKIE_NAME)?.value) ||
    (isDevOrTest && !!request.cookies.get(E2E_SESSION_COOKIE)?.value);

  console.log(`[Middleware] Path: ${pathname} | hasSession: ${hasSession} | cookies: ${request.cookies.getAll().map(c => c.name).join(', ')}`);

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
