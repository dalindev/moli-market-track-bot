import { fetchWithRetry, jitteredSleep } from '../rate-limiter';
import type { MarketResponse } from '@/types/market';

export interface MarketFetchParams {
  page: number;
  search?: string;
  type?: 'all' | '道具攤位' | '寵物攤位';
  server?: 'all' | '1' | '2' | '3' | '4' | '5';
  exact?: boolean;
}

export interface MarketFetchOptions {
  signal?: AbortSignal;
  minDelayMs?: number;     // default 400
  maxDelayMs?: number;     // default 900
}

export async function fetchMarketPage(
  params: MarketFetchParams,
  opts: MarketFetchOptions = {}
): Promise<MarketResponse> {
  const minDelay = opts.minDelayMs ?? 400;
  const maxDelay = opts.maxDelayMs ?? 900;
  await jitteredSleep(minDelay, maxDelay);

  if (opts.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  const qs = new URLSearchParams({
    page: String(params.page),
    search: params.search ?? '',
    type: params.type ?? 'all',
    server: params.server ?? 'all',
    exact: params.exact ? '1' : '0',
  });

  const res = await fetchWithRetry(
    `/api/market?${qs.toString()}`,
    { signal: opts.signal },
    { maxRetries: 3, baseDelayMs: 5_000 }
  );

  if (!res.ok) {
    throw new Error(`Market API returned ${res.status}`);
  }
  return (await res.json()) as MarketResponse;
}
