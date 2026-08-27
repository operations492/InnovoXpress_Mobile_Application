import { env } from '@/lib/env';
import { supabase } from '@/lib/supabase';

/**
 * The one place a request to the Express API is made.
 *
 * Two rules it exists to enforce:
 *  - every call carries a fresh Supabase access token, and
 *  - a 401 gets exactly ONE refresh-and-retry before the session is dropped.
 *    Retrying forever on a genuinely revoked account would spin, and not
 *    retrying at all would sign a driver out mid-run every time a token aged out
 *    while the phone was in a tunnel.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** A 409 is the status machine refusing, not a fault — worth saying plainly. */
  get isConflict(): boolean {
    return this.status === 409;
  }

  get isOffline(): boolean {
    return this.status === 0;
  }
}

/** Raised so the auth layer can drop the session without every caller checking. */
export class SessionExpiredError extends ApiError {
  constructor() {
    super(401, 'UNAUTHORIZED', 'Your session has expired. Please sign in again.');
    this.name = 'SessionExpiredError';
  }
}

async function accessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/** The backend answers `{ error: { code, message, details } }` on every failure. */
async function toApiError(res: Response): Promise<ApiError> {
  let code = 'HTTP_ERROR';
  let message = `Request failed (${res.status})`;
  let details: unknown;

  try {
    const body = (await res.json()) as {
      error?: { code?: string; message?: string; details?: unknown };
    };
    if (body?.error) {
      code = body.error.code ?? code;
      message = body.error.message ?? message;
      details = body.error.details;
    }
  } catch {
    // A proxy or a crashed process can answer with HTML; the status still tells
    // the driver something useful, so do not let the parse failure mask it.
  }

  return new ApiError(res.status, code, message, details);
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** JSON body. Mutually exclusive with `form`. */
  body?: unknown;
  /** Multipart body, for proof-of-delivery uploads. */
  form?: FormData;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Set false for calls that must not trigger a sign-out (e.g. a background flush). */
  retryOn401?: boolean;
  timeoutMs?: number;
}

async function once<T>(path: string, options: RequestOptions, token: string | null): Promise<T> {
  const { method = 'GET', body, form, headers = {}, signal, timeoutMs = 20_000 } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);

  try {
    const res = await fetch(`${env.apiUrl}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        // Content-Type is set by fetch for FormData (it has to add the multipart
        // boundary); setting it by hand produces a body multer cannot parse.
        ...(form ? {} : body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });

    if (!res.ok) throw await toApiError(res);
    if (res.status === 204) return undefined as T;

    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (e instanceof Error && e.name === 'AbortError') {
      throw new ApiError(0, 'TIMEOUT', 'The server took too long to answer. Check your signal.');
    }
    /*
     * Keep the underlying reason.
     *
     * React Native reports every transport failure as the same opaque
     * "Network request failed", and throwing that away here is what makes a
     * multipart upload dying on an unreadable file URI indistinguishable from
     * the phone genuinely being in a tunnel — both surface as "cannot reach the
     * server", and neither is debuggable from the screen.
     *
     * The user-facing copy is unchanged; the cause rides along in `details` and
     * is logged in development, where somebody is watching.
     */
    const cause = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    if (__DEV__) {
      /*
       * The BASE URL, not just the path.
       *
       * In development the host is derived from Metro rather than configured
       * (see `apiUrlFromMetro`), so "cannot reach the server" has two very
       * different causes — the server is down, or the app resolved a host that
       * is not the one running it. A path alone cannot tell those apart, and a
       * machine with VMware, Hyper-V and Wi-Fi adapters has several plausible
       * wrong answers.
       */
      console.warn(
        `[api] ${method} ${env.apiUrl}${path} failed at the transport layer — ${cause}`,
      );
    }

    throw new ApiError(
      0,
      'NETWORK',
      'Cannot reach the Innovo Xpress server. Your work is saved and will send when you are back online.',
      { cause },
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { retryOn401 = true } = options;
  const token = await accessToken();

  try {
    return await once<T>(path, options, token);
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 401) throw e;
    if (!retryOn401) throw e;

    const { data, error } = await supabase.auth.refreshSession();
    if (error || !data.session) throw new SessionExpiredError();

    try {
      return await once<T>(path, options, data.session.access_token);
    } catch (retryError) {
      if (retryError instanceof ApiError && retryError.status === 401) {
        throw new SessionExpiredError();
      }
      throw retryError;
    }
  }
}

export const api = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body' | 'form'>) =>
    request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'PATCH', body }),
  upload: <T>(path: string, form: FormData, options?: Omit<RequestOptions, 'method' | 'form'>) =>
    // Proof photos are up to 10 MB over a mobile uplink; the default 20s timeout
    // would abort a perfectly healthy upload on a weak signal.
    request<T>(path, { ...options, method: 'POST', form, timeoutMs: options?.timeoutMs ?? 90_000 }),
};
