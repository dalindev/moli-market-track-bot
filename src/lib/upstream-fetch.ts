// Server-side fetch wrapper for the two member.starcg.net endpoints.
//
// The upstream sheds load by answering `503 {"status":"error","error":"service_busy","retry_after":N}`
// — as a JSON body, with NO Retry-After header. It is transient: the same request usually succeeds a
// second or two later. Until this existed, every caller turned that blip into a hard failure, which is
// what made /enchant-stones look broken on first load and fine after a reload.
//
// Retrying here rather than in each hook fixes every caller at once (market search, enchant stones,
// the deal sweep, the cron jobs) and keeps the retry off the user's connection.

/** Error envelope the upstream returns for both 4xx and 5xx. */
interface UpstreamErrorBody {
  status?: string;
  error?: string;
  message?: string;
  retry_after?: number; // seconds
}

export interface UpstreamFailure {
  /** HTTP status we should hand back to our own client. */
  status: number;
  /** Machine-readable cause: service_busy | invalid_query | upstream_error | network_error | bad_payload */
  code: string;
  message: string;
  /** Seconds the caller should wait before trying again; 0 when unknown or not retryable. */
  retryAfterSeconds: number;
  attempts: number;
}

export type UpstreamResult<T> =
  | { ok: true; data: T }
  | { ok: false; failure: UpstreamFailure };

export interface UpstreamFetchOptions {
  signal?: AbortSignal;
  /** Total attempts including the first. Default 3. */
  maxAttempts?: number;
  /** First backoff step; doubles per attempt. Default 400ms. */
  baseDelayMs?: number;
  /** Never spend more than this waiting, so a serverless invocation can't stall. Default 6s. */
  maxTotalDelayMs?: number;
  /** Seconds to let Next cache the upstream response. Omit for always-fresh (`no-store`). */
  revalidateSeconds?: number;
  fetchFn?: typeof fetch;
  sleepFn?: (ms: number) => Promise<void>;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 400;
const DEFAULT_MAX_TOTAL_DELAY_MS = 6_000;

// The upstream throttles two different ways, both transient:
//   503 {"error":"service_busy","retry_after":N}  — load shedding
//   429 {"error":"rate_limited","retry_after":N}  — too many requests from us
// Listed by code as well as by status so an envelope returned with HTTP 200 is still retried.
const RETRYABLE_CODES = new Set(['service_busy', 'rate_limited']);

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function isErrorEnvelope(body: unknown): body is UpstreamErrorBody {
  return (
    typeof body === 'object' &&
    body !== null &&
    (body as UpstreamErrorBody).status === 'error'
  );
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

export async function fetchUpstreamJson<T>(
  url: string,
  options: UpstreamFetchOptions = {}
): Promise<UpstreamResult<T>> {
  const fetchFn = options.fetchFn ?? fetch;
  const sleepFn = options.sleepFn ?? defaultSleep;
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxTotalDelayMs = options.maxTotalDelayMs ?? DEFAULT_MAX_TOTAL_DELAY_MS;

  let spentDelayMs = 0;
  let failure: UpstreamFailure = {
    status: 502,
    code: 'network_error',
    message: 'Upstream request never completed',
    retryAfterSeconds: 0,
    attempts: 0,
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let retryable: boolean;

    try {
      const res = await fetchFn(url, {
        signal: options.signal,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Mozilla/5.0 (compatible; StarCGMarketTracker/1.0)',
        },
        ...(options.revalidateSeconds != null
          ? { next: { revalidate: options.revalidateSeconds } }
          : { cache: 'no-store' as const }),
      } as RequestInit);

      let body: unknown = null;
      let parseFailed = false;
      try {
        body = await res.json();
      } catch {
        parseFailed = true;
      }

      // The upstream also answers some errors with HTTP 200, so check the envelope regardless of status.
      if (res.ok && !parseFailed && !isErrorEnvelope(body)) {
        return { ok: true, data: body as T };
      }

      if (res.ok && parseFailed) {
        failure = {
          status: 502,
          code: 'bad_payload',
          message: 'Upstream returned a non-JSON body',
          retryAfterSeconds: 0,
          attempts: attempt,
        };
        retryable = true;
      } else {
        const envelope = isErrorEnvelope(body) ? body : {};
        const code = envelope.error ?? (res.ok ? 'upstream_error' : `http_${res.status}`);
        // An error envelope on a 200 still means the request failed; give it a real status.
        const status = res.ok ? 400 : res.status;
        failure = {
          status,
          code,
          message: envelope.message ?? `Upstream responded with ${res.status}`,
          retryAfterSeconds: Math.max(0, Number(envelope.retry_after) || 0),
          attempts: attempt,
        };
        retryable =
          RETRYABLE_CODES.has(code) || res.status === 429 || res.status >= 500;
      }
    } catch (err) {
      // A cancelled request is the caller's decision, never something to retry.
      if (isAbort(err)) throw err;
      failure = {
        status: 502,
        code: 'network_error',
        message: err instanceof Error ? err.message : String(err),
        retryAfterSeconds: 0,
        attempts: attempt,
      };
      retryable = true;
    }

    if (!retryable || attempt === maxAttempts) break;

    // The upstream tells us how long to wait; fall back to exponential backoff when it doesn't.
    const suggestedMs = failure.retryAfterSeconds * 1000;
    const delayMs = suggestedMs > 0 ? suggestedMs : baseDelayMs * 2 ** (attempt - 1);
    if (spentDelayMs + delayMs > maxTotalDelayMs) break;

    spentDelayMs += delayMs;
    await sleepFn(delayMs);
  }

  return { ok: false, failure };
}
