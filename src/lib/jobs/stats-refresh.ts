import type { SupabaseClient } from '@supabase/supabase-js';
import type { MarketRecordResponseV2 } from '@/types/market';
import type { ScanRunOutcome } from '@/types/scanner';
import { fetchMarketRecord } from '../api-clients/marketrecord';
import { computeMedian } from '../threshold';

export interface CurrencyStats {
  median: number;
  min: number;
  max: number;
  count: number;
}

export interface PerCurrencyStats {
  gold: CurrencyStats | null;
  crystal: CurrencyStats | null;
}

export function pickPerCurrencyStats(res: MarketRecordResponseV2): PerCurrencyStats {
  if (res.stats.pricetype_mixed) {
    // Mixed → compute per-currency from logs ourselves
    const goldPrices = res.logs.filter((l) => l.pricetype === 0 && l.unit_price > 0).map((l) => l.unit_price);
    const crystalPrices = res.logs.filter((l) => l.pricetype === 1 && l.unit_price > 0).map((l) => l.unit_price);

    return {
      gold: goldPrices.length > 0 ? {
        median: Math.round(computeMedian(goldPrices)),
        min: Math.min(...goldPrices),
        max: Math.max(...goldPrices),
        count: goldPrices.length,
      } : null,
      crystal: crystalPrices.length > 0 ? {
        median: Math.round(computeMedian(crystalPrices)),
        min: Math.min(...crystalPrices),
        max: Math.max(...crystalPrices),
        count: crystalPrices.length,
      } : null,
    };
  }

  if (res.stats.pricetype_single === 0) {
    return {
      gold: { median: res.stats.median, min: res.stats.min, max: res.stats.max, count: res.stats.count },
      crystal: null,
    };
  }
  if (res.stats.pricetype_single === 1) {
    return {
      gold: null,
      crystal: { median: res.stats.median, min: res.stats.min, max: res.stats.max, count: res.stats.count },
    };
  }
  return { gold: null, crystal: null };
}

export interface StatsRefreshDeps {
  supabase: SupabaseClient;
  signal: AbortSignal;
  onProgress: (update: { currentPage: number; totalPages: number; note?: string }) => void;
  scope: 'all' | 'next_n';
  nextN: number;
}

export async function runStatsRefresh(deps: StatsRefreshDeps): Promise<ScanRunOutcome> {
  let itemsScanned = 0;
  let pricesRecorded = 0;
  try {
    // Pick items, oldest refresh first
    let query = deps.supabase
      .from('items')
      .select('id, name, item_level, last_history_refresh')
      .eq('is_auto_discovered', true)
      .order('last_history_refresh', { ascending: true, nullsFirst: true });
    if (deps.scope === 'next_n') {
      query = query.limit(deps.nextN);
    }
    const { data: items, error } = await query;
    if (error) throw new Error(error.message);

    const total = items?.length ?? 0;
    if (total === 0) {
      deps.onProgress({ currentPage: 0, totalPages: 0, note: 'No items to refresh.' });
      return { status: 'completed', itemsScanned: 0, pricesRecorded: 0, errorMessage: null };
    }

    for (let i = 0; i < total; i += 1) {
      if (deps.signal.aborted) {
        return { status: 'aborted', itemsScanned, pricesRecorded, errorMessage: null };
      }
      const item = items![i];
      itemsScanned += 1;
      deps.onProgress({ currentPage: i + 1, totalPages: total, note: `Refreshing ${item.name}...` });

      // Fetch with currency=0 then currency=1. Server may ignore currency for log filter,
      // but pickPerCurrencyStats handles mixed responses too.
      const goldRes = await fetchMarketRecord(
        { page: 1, search: item.name, range: '30d', sort: 'time_desc', currency: '0' },
        { signal: deps.signal }
      );
      const crystalRes = await fetchMarketRecord(
        { page: 1, search: item.name, range: '30d', sort: 'time_desc', currency: '1' },
        { signal: deps.signal }
      );

      const goldStats = pickPerCurrencyStats(goldRes).gold;
      const crystalStats = pickPerCurrencyStats(crystalRes).crystal;
      // Use trend6m from whichever response has more data
      const trend6m = (goldRes.trend6m.days.length >= crystalRes.trend6m.days.length)
        ? goldRes.trend6m
        : crystalRes.trend6m;

      const update: Record<string, unknown> = {
        last_history_refresh: new Date().toISOString(),
        trend6m_cache: trend6m,
        trend6m_cached_at: new Date().toISOString(),
      };
      if (goldStats) {
        update.median_gold_value = goldStats.median;
        update.min_sold_gold = goldStats.min;
        update.max_sold_gold = goldStats.max;
        update.sample_count_gold = goldStats.count;
      }
      if (crystalStats) {
        update.median_crystal_value = crystalStats.median;
        update.min_sold_crystal = crystalStats.min;
        update.max_sold_crystal = crystalStats.max;
        update.sample_count_crystal = crystalStats.count;
      }

      const { error: updErr } = await deps.supabase
        .from('items')
        .update(update)
        .eq('id', item.id);
      if (updErr) {
        console.error('[stats-refresh] update failed:', updErr.message);
        continue;
      }
      pricesRecorded += 1;
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
