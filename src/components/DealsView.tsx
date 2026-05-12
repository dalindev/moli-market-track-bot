'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { findDeals, sortDeals, type RankedListing } from '@/lib/deal-finder';
import { DealCard } from '@/components/DealCard';
import { useScanner } from '@/hooks/useScanner';

const DEFAULT_MIN_DEAL_PCT = 30;
const DEFAULT_SCREAMING_DEAL_PCT = 50;
const FALLBACK_RATE = 250;

type ServerFilter = 'all' | '1' | '2' | '3' | '4' | '5';
type CurrencyFilter = 'all' | 'gold' | 'crystal';

export function DealsView() {
  const [deals, setDeals] = useState<RankedListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [minPct, setMinPct] = useState(DEFAULT_MIN_DEAL_PCT);
  const [serverFilter, setServerFilter] = useState<ServerFilter>('all');
  const [currencyFilter, setCurrencyFilter] = useState<CurrencyFilter>('all');
  const [hidePets, setHidePets] = useState(false);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);

  const { jobStates, start, stop } = useScanner();
  const sweepState = jobStates.market_sweep;

  const fetchDeals = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();

    // 1. Items with their fair-value metadata
    const { data: items } = await supabase
      .from('items')
      .select('id, name, item_type, item_level, image_path, fair_value_gold, fair_value_source, fair_value_exchange_rate, median_gold_value, median_crystal_value');

    // 2. Current market snapshots
    const { data: snapshots } = await supabase
      .from('price_snapshots')
      .select('id, item_id, price, pricetype, server, stall_name, stall_cdkey, coords, quantity, recorded_at')
      .eq('source', 'market');

    if (!items || !snapshots) {
      setDeals([]);
      setLoading(false);
      return;
    }

    const found = findDeals({
      items: items as Parameters<typeof findDeals>[0]['items'],
      snapshots: snapshots as Parameters<typeof findDeals>[0]['snapshots'],
      fallbackExchangeRate: FALLBACK_RATE,
      minDealPct: minPct,
      screamingDealPct: DEFAULT_SCREAMING_DEAL_PCT,
    });
    setDeals(sortDeals(found));
    setLastFetched(new Date());
    setLoading(false);
  }, [minPct]);

  useEffect(() => {
    fetchDeals();
  }, [fetchDeals]);

  // Re-fetch automatically when market sweep completes
  useEffect(() => {
    if (sweepState.status === 'success' || sweepState.status === 'aborted') {
      fetchDeals();
    }
  }, [sweepState.status, fetchDeals]);

  const filtered = deals.filter((d) => {
    if (hidePets && d.itemType === 'pet') return false;
    if (serverFilter !== 'all' && String(d.server) !== serverFilter) return false;
    if (currencyFilter === 'gold' && d.pricetype !== 0) return false;
    if (currencyFilter === 'crystal' && d.pricetype !== 1) return false;
    return true;
  });

  const screamingCount = filtered.filter((d) => d.isScreamingDeal).length;
  const mispriceCount = filtered.filter((d) => d.isMispriceCandidate).length;
  const sweepRunning = sweepState.status === 'running';

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <div className="flex items-baseline gap-2 flex-wrap">
          <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Deals</h2>
          <span className="text-sm text-zinc-500">
            {loading ? 'loading...' : `${filtered.length} active`}
            {screamingCount > 0 && <> · <span className="text-red-600 dark:text-red-400">🔥 {screamingCount} screaming</span></>}
            {mispriceCount > 0 && <> · <span className="text-orange-600 dark:text-orange-400">⚠ {mispriceCount} misprice-prone</span></>}
          </span>
        </div>
        {lastFetched && (
          <p className="text-xs text-zinc-500 mt-1">
            Last loaded: {lastFetched.toLocaleTimeString()}
          </p>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2 flex-wrap p-3 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
        {sweepRunning ? (
          <button
            onClick={() => stop('market_sweep')}
            className="text-sm px-3 py-1.5 rounded bg-red-600 hover:bg-red-700 text-white font-medium"
          >
            ✕ Stop sweep ({sweepState.progress?.currentPage ?? 0}/{sweepState.progress?.totalPages ?? '?'})
          </button>
        ) : (
          <button
            onClick={() => start('market_sweep')}
            className="text-sm px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
          >
            ↻ Refresh now (Market sweep)
          </button>
        )}
        <button
          onClick={fetchDeals}
          disabled={loading}
          className="text-sm px-3 py-1.5 rounded border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
        >
          ⟳ Reload list
        </button>

        <div className="h-6 w-px bg-zinc-300 dark:bg-zinc-700 mx-1" />

        {/* Min % filter chips */}
        <span className="text-xs text-zinc-500">Min:</span>
        {[20, 30, 50, 75].map((pct) => (
          <button
            key={pct}
            onClick={() => setMinPct(pct)}
            className={`text-xs px-2 py-1 rounded border ${minPct === pct ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 border-zinc-900 dark:border-zinc-100' : 'border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
          >
            {pct}%+
          </button>
        ))}

        <div className="h-6 w-px bg-zinc-300 dark:bg-zinc-700 mx-1" />

        {/* Server */}
        <select
          value={serverFilter}
          onChange={(e) => setServerFilter(e.target.value as ServerFilter)}
          className="text-xs px-2 py-1 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900"
        >
          <option value="all">All servers</option>
          <option value="1">S1</option>
          <option value="2">S2</option>
          <option value="3">S3</option>
          <option value="4">S4</option>
          <option value="5">S5</option>
        </select>

        {/* Currency */}
        <select
          value={currencyFilter}
          onChange={(e) => setCurrencyFilter(e.target.value as CurrencyFilter)}
          className="text-xs px-2 py-1 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900"
        >
          <option value="all">All currencies</option>
          <option value="gold">💰 Gold only</option>
          <option value="crystal">💎 Crystal only</option>
        </select>

        {/* Hide pets */}
        <label className="text-xs text-zinc-600 dark:text-zinc-400 flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={hidePets}
            onChange={(e) => setHidePets(e.target.checked)}
            className="rounded"
          />
          Hide pets
        </label>
      </div>

      {/* Sweep progress note */}
      {sweepRunning && (
        <div className="text-sm p-2 rounded bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
          Refreshing market... page {sweepState.progress?.currentPage} of {sweepState.progress?.totalPages}. {sweepState.progress?.latestNote}
        </div>
      )}

      {/* Deals list */}
      {loading ? (
        <div className="text-sm text-zinc-500 py-8 text-center">Loading deals...</div>
      ) : filtered.length === 0 ? (
        <div className="text-sm text-zinc-500 py-8 text-center">
          No deals match the current filters. Try lowering the % threshold or running Market sweep.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.slice(0, 100).map((d) => (
            <DealCard key={d.snapshotId} deal={d} />
          ))}
        </div>
      )}
      {filtered.length > 100 && (
        <div className="text-xs text-zinc-500 text-center">
          Showing top 100 of {filtered.length}. Narrow filters to see more.
        </div>
      )}
    </div>
  );
}
