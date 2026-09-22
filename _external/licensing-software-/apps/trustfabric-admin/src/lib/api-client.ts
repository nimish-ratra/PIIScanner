/**
 * apiClient
 *
 * Thin HTTP client for the Trustfabric Admin (vendor) Portal API.
 *
 * Authentication: session-cookie based, same mechanism as the Customer Portal
 * (see apps/api/src/auth/auth.guard.ts — AUTH_MODE=password uses the TF_SESSION
 * cookie, AUTH_MODE=e2e / dev uses the E2E_SESSION cookie). There is no
 * Bearer-token auth path in the backend — it was fully removed — so this
 * client never sends an Authorization header and never reads localStorage
 * for credentials.
 *
 * Error handling mirrors the Customer Portal's api-client:
 *   401 → ApiError (AuthProvider redirects/re-establishes session)
 *   403 → ApiError (insufficient vendor permissions)
 *   404 → ApiError (resource not found)
 *   409 → ApiError (concurrency conflict — caller should retry)
 *   429 → ApiError (rate limited)
 *   5xx → ApiError (server error)
 */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  (typeof window !== 'undefined'
    ? '/api/v1/vendor'
    : 'http://localhost:3001/api/v1/vendor');

export async function apiClient<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);

  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  // Normalize endpoint to prevent double '/vendor' if caller includes it
  const normalizedEndpoint = endpoint.startsWith('/vendor/')
    ? endpoint.slice('/vendor'.length)
    : endpoint.startsWith('/') ? endpoint : `/${endpoint}`;

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${normalizedEndpoint}`, {
      ...options,
      headers,
      credentials: 'include', // sends the session cookie automatically
    });
  } catch (networkError) {
    throw new ApiError(0, 'Failed to fetch', networkError);
  }

  let data: unknown;
  try {
    const text = await response.text();
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = undefined;
  }

  if (!response.ok) {
    const serverMessage =
      data && typeof data === 'object' && 'message' in data
        ? Array.isArray((data as any).message)
          ? (data as any).message.join(', ')
          : String((data as any).message)
        : undefined;

    const fallbackMessages: Record<number, string> = {
      401: 'Your session has expired. Please sign in again.',
      403: 'You do not have permission to perform this action.',
      404: 'Resource not found.',
      409: 'Concurrent modification detected. Please try again.',
      429: 'Too many requests. Please slow down.',
      500: 'An internal server error occurred.',
    };

    const message = serverMessage ?? fallbackMessages[response.status] ?? 'An unexpected error occurred.';
    throw new ApiError(response.status, message, data);
  }

  return data as T;
}
