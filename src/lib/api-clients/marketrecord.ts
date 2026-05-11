import { fetchWithRetry, jitteredSleep } from '../rate-limiter';
import type { MarketRecordResponseV2 } from '@/types/market';

export type MarketRecordSort = 'time_desc' | 'time_asc' | 'price_asc' | 'price_desc';
export type MarketRecordRange = '1d' | '7d' | '30d' | '6m';
export type MarketRecordCurrency = 'all' | '0' | '1';
export type MarketRecordType = 'all' | 'item' | 'pet';

export interface MarketRecordFetchParams {
  page: number;
  search?: string;
  type?: MarketRecordType;
  range?: MarketRecordRange;
  currency?: MarketRecordCurrency;
  sort?: MarketRecordSort;
}

export interface MarketRecordFetchOptions {
  signal?: AbortSignal;
  minDelayMs?: number;
  maxDelayMs?: number;
}

export async function fetchMarketRecord(
  params: MarketRecordFetchParams,
  opts: MarketRecordFetchOptions = {}
): Promise<MarketRecordResponseV2> {
  const minDelay = opts.minDelayMs ?? 1500;
  const maxDelay = opts.maxDelayMs ?? 3000;
  await jitteredSleep(minDelay, maxDelay);

  if (opts.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  const qs = new URLSearchParams({
    page: String(params.page),
    search: params.search ?? '',
    type: params.type ?? 'all',
    range: params.range ?? '30d',
    currency: params.currency ?? 'all',
    sort: params.sort ?? 'time_desc',
  });

  const res = await fetchWithRetry(
    `/api/marketrecord?${qs.toString()}`,
    { signal: opts.signal },
    { maxRetries: 3, baseDelayMs: 5_000 }
  );

  if (!res.ok) {
    throw new Error(`MarketRecord API returned ${res.status}`);
  }
  return (await res.json()) as MarketRecordResponseV2;
}
