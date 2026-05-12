import type { SupabaseClient } from '@supabase/supabase-js';
import type { MarketRecordResponseV2 } from '@/types/market';
import type { ScanRunOutcome } from '@/types/scanner';
import { fetchMarketRecord } from '../api-clients/marketrecord';
import { computeMedian } from '../threshold';
import { computeFairValue } from '../fair-value';

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
    // Fetch items with current listings first (joins to price_snapshots)
    // Use raw IN-clause via a subquery alternative: 2 queries
    const { data: listedItemIds } = await deps.supabase
      .from('price_snapshots')
      .select('item_id')
      .eq('source', 'market');
    const listedSet = new Set((listedItemIds ?? []).map((r) => r.item_id));

    let query = deps.supabase
      .from('items')
      .select('id, name, item_level, last_history_refresh')
      .order('last_history_refresh', { ascending: true, nullsFirst: true });
    if (deps.scope === 'next_n') {
      query = query.limit(deps.nextN);
    }
    const { data: items, error } = await query;
    if (error) throw new Error(error.message);

    // Sort: listed items first, then by stale-ness (already DB-sorted)
    const sortedItems = [...(items ?? [])].sort((a, b) => {
      const aL = listedSet.has(a.id) ? 0 : 1;
      const bL = listedSet.has(b.id) ? 0 : 1;
      if (aL !== bL) return aL - bL;
      return 0; // preserve DB order for ties
    });

    const { data: rateRow } = await deps.supabase
      .from('derived_exchange_rate')
      .select('gold_per_crystal')
      .order('computed_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const exchangeRate = rateRow?.gold_per_crystal ?? 250; // fallback to ~observed rate

    const total = sortedItems.length;
    if (total === 0) {
      deps.onProgress({ currentPage: 0, totalPages: 0, note: 'No items to refresh.' });
      return { status: 'completed', itemsScanned: 0, pricesRecorded: 0, errorMessage: null };
    }

    // Cache responses keyed by item.name — multiple items can share a name
    // (e.g., 改造圖A at levels 5/6/7). The marketrecord.php API doesn't
    // differentiate by level so the response would be identical → cache.
    const responseCache = new Map<string, MarketRecordResponseV2>();

    for (let i = 0; i < total; i += 1) {
      if (deps.signal.aborted) {
        return { status: 'aborted', itemsScanned, pricesRecorded, errorMessage: null };
      }
      const item = sortedItems[i];
      itemsScanned += 1;
      const cached = responseCache.has(item.name);
      deps.onProgress({
        currentPage: i + 1,
        totalPages: total,
        note: `${cached ? '(cached) ' : ''}Refreshing ${item.name}...`,
      });

      // Single call with currency=all — pickPerCurrencyStats handles the mixed response
      // If another item already triggered this exact API call this run, reuse the response.
      let res = responseCache.get(item.name);
      if (!res) {
        res = await fetchMarketRecord(
          { page: 1, search: item.name, range: '30d', sort: 'time_desc', currency: 'all' },
          { signal: deps.signal }
        );
        responseCache.set(item.name, res);
      }
      const stats = pickPerCurrencyStats(res);
      const goldStats = stats.gold;
      const crystalStats = stats.crystal;
      const trend6m = res.trend6m;

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

      const fair = computeFairValue({
        medianGold: goldStats?.median ?? null,
        medianCrystal: crystalStats?.median ?? null,
        sampleCountGold: goldStats?.count ?? 0,
        sampleCountCrystal: crystalStats?.count ?? 0,
        exchangeRate,
      });
      update.fair_value_gold = fair.value;
      update.fair_value_source = fair.source;
      update.fair_value_exchange_rate = exchangeRate;
      update.fair_value_computed_at = new Date().toISOString();

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
