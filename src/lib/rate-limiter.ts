export function jitteredSleep(minMs: number, maxMs: number): Promise<void> {
  const ms = minMs + Math.random() * (maxMs - minMs);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface CircuitBreakerConfig {
  failureThreshold: number;
  pauseMs: number;
}

export class CircuitBreaker {
  private failures = 0;
  private _pausedUntil: number | null = null;
  constructor(private readonly config: CircuitBreakerConfig) {}

  recordFailure(): void {
    this.failures += 1;
    if (this.failures >= this.config.failureThreshold) {
      this._pausedUntil = Date.now() + this.config.pauseMs;
    }
  }

  recordSuccess(): void {
    this.failures = 0;
    this._pausedUntil = null;
  }

  pausedUntil(): number | null {
    if (this._pausedUntil && this._pausedUntil <= Date.now()) {
      this._pausedUntil = null;
    }
    return this._pausedUntil;
  }

  reset(): void {
    this.failures = 0;
    this._pausedUntil = null;
  }
}

export interface FetchRetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  fetchFn?: typeof fetch;
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  config: FetchRetryConfig
): Promise<Response> {
  const fetchFn = config.fetchFn ?? fetch;
  let lastStatus = 0;

  for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
    const res = await fetchFn(url, init);
    if (res.ok) return res;

    lastStatus = res.status;

    // Don't retry 4xx except 429
    if (res.status >= 400 && res.status < 500 && res.status !== 429) {
      return res;
    }

    if (attempt === config.maxRetries) break;

    let delayMs: number;
    if (res.status === 429) {
      const retryAfter = res.headers.get('Retry-After');
      delayMs = retryAfter ? Number(retryAfter) * 1000 : 30_000;
    } else {
      delayMs = config.baseDelayMs * Math.pow(3, attempt); // 100, 300, 900, 2700...
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error(`Max retries exceeded (last status: ${lastStatus})`);
}
