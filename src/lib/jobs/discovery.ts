import type { SupabaseClient } from '@supabase/supabase-js';
import type { PriceHistoryLogExtended } from '@/types/market';
import type { ScanRunOutcome } from '@/types/scanner';
import { computeMedian } from '../threshold';
import { VALUABLE_GOLD_THRESHOLD, VALUABLE_CRYSTAL_THRESHOLD } from '@/types/scanner';
import { fetchMarketRecord } from '../api-clients/marketrecord';
import { deriveExchangeRate } from '../exchange-rate';

export interface ValuableCandidate {
  name: string;
  pricetype: number;
  median: number;
  sampleSize: number;
}

export function groupValuableCandidates(logs: PriceHistoryLogExtended[]): ValuableCandidate[] {
  const groups = new Map<string, number[]>();
  for (const log of logs) {
    if (!log.item_name || log.unit_price <= 0) continue;
    const key = `${log.item_name}::${log.pricetype}`;
    const arr = groups.get(key) ?? [];
    arr.push(log.unit_price);
    groups.set(key, arr);
  }

  const candidates: ValuableCandidate[] = [];
  for (const [key, prices] of groups) {
    const [name, ptStr] = key.split('::');
    const pricetype = Number(ptStr);
    const median = computeMedian(prices);
    const threshold = pricetype === 0 ? VALUABLE_GOLD_THRESHOLD : VALUABLE_CRYSTAL_THRESHOLD;
    if (median >= threshold) {
      candidates.push({ name, pricetype, median, sampleSize: prices.length });
    }
  }
  return candidates;
}

export interface DiscoveryDeps {
  supabase: SupabaseClient;
  signal: AbortSignal;
  onProgress: (update: { currentPage: number; totalPages: number; note?: string }) => void;
  pages: number;
}

export async function runDiscovery(deps: DiscoveryDeps): Promise<ScanRunOutcome> {
  let itemsScanned = 0;
  let pricesRecorded = 0;
  const allLogs: PriceHistoryLogExtended[] = [];

  try {
    for (let page = 1; page <= deps.pages; page += 1) {
      if (deps.signal.aborted) {
        return { status: 'aborted', itemsScanned, pricesRecorded, errorMessage: null };
      }
      const res = await fetchMarketRecord(
        { page, range: '30d', sort: 'price_desc', currency: 'all', type: 'all' },
        { signal: deps.signal }
      );
      allLogs.push(...res.logs);
      itemsScanned += res.logs.length;
      deps.onProgress({ currentPage: page, totalPages: deps.pages });
    }

    const candidates = groupValuableCandidates(allLogs);
    deps.onProgress({ currentPage: deps.pages, totalPages: deps.pages, note: `Found ${candidates.length} valuable candidates` });

    // Upsert items table — only inserts items not already present.
    for (const c of candidates) {
      const { data: existing } = await deps.supabase
        .from('items')
        .select('id')
        .eq('name', c.name)
        .is('item_level', null)
        .maybeSingle();
      if (existing) continue;

      const { error } = await deps.supabase.from('items').insert({
        name: c.name,
        item_type: 'item',
        is_auto_discovered: true,
      });
      if (error) {
        console.error('[discovery] insert failed:', error.message);
        continue;
      }
      pricesRecorded += 1;
      deps.onProgress({
        currentPage: deps.pages,
        totalPages: deps.pages,
        note: `Discovered: ${c.name}`,
      });
    }

    // Derive exchange rate
    const rate = deriveExchangeRate(allLogs);
    if (rate) {
      await deps.supabase.from('derived_exchange_rate').insert({
        gold_per_crystal: rate.gold_per_crystal,
        source_item_name: rate.source_item_name,
        sample_size: rate.sample_size,
        median_crystal_price: rate.median_crystal_price,
      });
      deps.onProgress({
        currentPage: deps.pages,
        totalPages: deps.pages,
        note: `Exchange rate: ${rate.gold_per_crystal.toFixed(2)} gold/crystal (n=${rate.sample_size})`,
      });
    }

    return { status: 'completed', itemsScanned, pricesRecorded, errorMessage: null };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { status: 'aborted', itemsScanned, pricesRecorded, errorMessage: null };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { status: 'failed', itemsScanned, pricesRecorded, errorMessage: msg };
  }
}
