/**
 * apiClient
 *
 * Thin HTTP client for the Customer Portal API.
 *
 * Authentication: session-cookie based. The browser sends the TF_SESSION
 * (or E2E_SESSION) httpOnly cookie automatically via `credentials: 'include'`.
 * No Bearer tokens, no localStorage, no manual token injection.
 *
 * Error handling:
 *   401 → redirect to /login (session expired or missing)
 *   403 → throw ApiError (insufficient permissions — show error boundary)
 *   404 → throw ApiError (resource not found)
 *   409 → throw ApiError (concurrency conflict — caller should retry)
 *   429 → throw ApiError (rate limited)
 *   5xx → throw ApiError (server error)
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
    ? '/api/v1/customer'
    : 'http://localhost:3001/api/v1/customer');

export async function apiClient<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);

  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  // Normalize endpoint to prevent double '/customer' if caller includes it
  const normalizedEndpoint = endpoint.startsWith('/customer/')
    ? endpoint.slice('/customer'.length)
    : endpoint.startsWith('/') ? endpoint : `/${endpoint}`;

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${normalizedEndpoint}`, {
      ...options,
      headers,
      credentials: 'include', // sends session cookie automatically
    });
  } catch (networkError) {
    // Network-level failure (server down, DNS, etc.)
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

    // Return 401 as a normal ApiError so AuthProvider can handle it
    // with Next.js router.replace() instead of a hard reload loop.
    const fallbackMessages: Record<number, string> = {
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
