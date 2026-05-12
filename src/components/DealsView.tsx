'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { findDeals, sortDeals, type RankedListing } from '@/lib/deal-finder';
import { useScannerState } from '@/components/providers/ScannerProvider';

const DEFAULT_MIN_DEAL_PCT = 30;
const DEFAULT_SCREAMING_DEAL_PCT = 50;
const FALLBACK_RATE = 250;
// Only consider listings from the last 2 hours as "current". Anything older is stale leftover from prior sweeps.
const SNAPSHOT_FRESHNESS_HOURS = 2;

const GOLD = '💰';
const CRYSTAL = '💎';

type ServerFilter = 'all' | '1' | '2' | '3' | '4' | '5';
type CurrencyFilter = 'all' | 'gold' | 'crystal';

function fmt(n: number | null | undefined): string {
  if (n == null) return '—';
  return n.toLocaleString();
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className="text-xs px-1.5 py-0.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
      title="Copy server + coords"
    >
      {copied ? '✓' : '📋'}
    </button>
  );
}

export function DealsView() {
  const [deals, setDeals] = useState<RankedListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [minPct, setMinPct] = useState(DEFAULT_MIN_DEAL_PCT);
  const [serverFilter, setServerFilter] = useState<ServerFilter>('all');
  const [currencyFilter, setCurrencyFilter] = useState<CurrencyFilter>('all');
  const [hidePets, setHidePets] = useState(false);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);

  const { jobStates, start, stop } = useScannerState();
  const sweepState = jobStates.market_sweep;

  const fetchDeals = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();

    const freshnessCutoff = new Date(Date.now() - SNAPSHOT_FRESHNESS_HOURS * 60 * 60 * 1000).toISOString();

    const { data: items } = await supabase
      .from('items')
      .select('id, name, item_type, item_level, image_path, fair_value_gold, fair_value_source, fair_value_exchange_rate, median_gold_value, median_crystal_value');

    // Only include recent snapshots — stale rows from old sweeps are filtered out
    const { data: snapshots } = await supabase
      .from('price_snapshots')
      .select('id, item_id, price, pricetype, server, stall_name, stall_cdkey, coords, quantity, recorded_at')
      .eq('source', 'market')
      .gte('recorded_at', freshnessCutoff);

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

  useEffect(() => {
    if (sweepState.status === 'success' || sweepState.status === 'aborted' || sweepState.status === 'failed') {
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
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-baseline gap-2 flex-wrap">
        <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Deals</h2>
        <span className="text-sm text-zinc-500">
          {loading ? 'loading...' : `${filtered.length} active`}
          {screamingCount > 0 && <> · <span className="text-red-600 dark:text-red-400">🔥 {screamingCount} screaming</span></>}
          {mispriceCount > 0 && <> · <span className="text-orange-600 dark:text-orange-400">⚠ {mispriceCount} misprice-prone</span></>}
        </span>
        {lastFetched && (
          <span className="text-xs text-zinc-500 ml-auto">
            loaded {lastFetched.toLocaleTimeString()} · fresh window: {SNAPSHOT_FRESHNESS_HOURS}h
          </span>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2 flex-wrap p-2 rounded bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
        {sweepRunning ? (
          <button
            onClick={() => stop('market_sweep')}
            className="text-sm px-3 py-1.5 rounded bg-red-600 hover:bg-red-700 text-white font-medium"
          >
            ✕ Stop ({sweepState.progress?.currentPage ?? 0}/{sweepState.progress?.totalPages ?? '?'})
          </button>
        ) : (
          <button
            onClick={() => start('market_sweep')}
            className="text-sm px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
          >
            ↻ Refresh now
          </button>
        )}
        <button
          onClick={fetchDeals}
          disabled={loading}
          className="text-sm px-3 py-1.5 rounded border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
        >
          ⟳ Reload
        </button>

        <div className="h-6 w-px bg-zinc-300 dark:bg-zinc-700 mx-1" />

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

        <select
          value={currencyFilter}
          onChange={(e) => setCurrencyFilter(e.target.value as CurrencyFilter)}
          className="text-xs px-2 py-1 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900"
        >
          <option value="all">All currencies</option>
          <option value="gold">{GOLD} Gold only</option>
          <option value="crystal">{CRYSTAL} Crystal only</option>
        </select>

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

      {sweepRunning && (
        <div className="text-xs p-2 rounded bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
          Refreshing market... page {sweepState.progress?.currentPage} / {sweepState.progress?.totalPages}. {sweepState.progress?.latestNote}
        </div>
      )}

      {sweepState.status === 'failed' && sweepState.lastError && (
        <div className="text-xs p-2 rounded bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300">
          Last sweep failed: {sweepState.lastError}
        </div>
      )}
      {sweepState.status === 'aborted' && (
        <div className="text-xs p-2 rounded bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
          Last sweep was stopped.
        </div>
      )}

      {/* Deals as compact rows */}
      {loading ? (
        <div className="text-sm text-zinc-500 py-6 text-center">Loading deals...</div>
      ) : filtered.length === 0 ? (
        <div className="text-sm text-zinc-500 py-6 text-center">
          No deals match. Lower the % threshold or run Refresh now.
        </div>
      ) : (
        <div className="overflow-x-auto -mx-2 sm:mx-0">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
              <tr>
                <th className="text-left py-1.5 px-2 w-8"></th>
                <th className="text-left py-1.5 px-2">Item</th>
                <th className="text-right py-1.5 px-2">Listed</th>
                <th className="text-right py-1.5 px-2">vs Fair</th>
                <th className="text-right py-1.5 px-2">vs Peers</th>
                <th className="text-right py-1.5 px-2">Profit</th>
                <th className="text-left py-1.5 px-2">Location</th>
                <th className="text-right py-1.5 px-2">When</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 200).map((d) => {
                const isHot = (Date.now() - new Date(d.recordedAt).getTime()) < 10 * 60 * 1000;
                const priceCur = d.pricetype === 0 ? GOLD : CRYSTAL;
                const rowAccent = d.isScreamingDeal
                  ? 'border-l-4 border-l-red-500'
                  : d.isMispriceCandidate
                  ? 'border-l-4 border-l-orange-400'
                  : 'border-l-4 border-l-transparent';

                return (
                  <tr
                    key={d.snapshotId}
                    className={`${rowAccent} border-b border-zinc-100 dark:border-zinc-800/60 hover:bg-zinc-50 dark:hover:bg-zinc-900/40`}
                  >
                    <td className="py-1.5 px-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {d.imagePath
                        ? <img src={d.imagePath} alt="" className="w-7 h-7 object-contain" />
                        : <div className="w-7 h-7 bg-zinc-100 dark:bg-zinc-800 rounded" />}
                    </td>
                    <td className="py-1.5 px-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-medium text-zinc-900 dark:text-zinc-100">{d.itemName}</span>
                        {d.itemType === 'pet' && (
                          <span className="text-[10px] px-1 py-0.5 rounded bg-pink-100 text-pink-700 dark:bg-pink-950 dark:text-pink-300">pet</span>
                        )}
                        {d.itemLevel != null && d.itemLevel > 0 && (
                          <span className="text-[10px] text-zinc-500">Lv{d.itemLevel}</span>
                        )}
                        {d.isScreamingDeal && (
                          <span className="text-[10px] px-1 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300 font-bold">🔥</span>
                        )}
                        {d.isMispriceCandidate && !d.isScreamingDeal && (
                          <span className="text-[10px] px-1 py-0.5 rounded bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300">⚠</span>
                        )}
                      </div>
                      {d.fairValueGold && (
                        <div className="text-[11px] text-zinc-500">
                          fair {fmt(d.fairValueGold)} {GOLD}
                        </div>
                      )}
                    </td>
                    <td className="py-1.5 px-2 text-right whitespace-nowrap font-semibold text-zinc-900 dark:text-zinc-100">
                      {fmt(d.price)} {priceCur}
                    </td>
                    <td className="py-1.5 px-2 text-right whitespace-nowrap">
                      {d.pctBelowFair != null ? (
                        <span className={d.pctBelowFair >= 50 ? 'text-emerald-700 dark:text-emerald-400 font-medium' : 'text-zinc-600 dark:text-zinc-400'}>
                          −{d.pctBelowFair}%
                        </span>
                      ) : <span className="text-zinc-400">—</span>}
                    </td>
                    <td className="py-1.5 px-2 text-right whitespace-nowrap">
                      {d.pctBelowListingMedian != null ? (
                        <span className={d.pctBelowListingMedian >= 50 ? 'text-emerald-700 dark:text-emerald-400 font-medium' : 'text-zinc-600 dark:text-zinc-400'}>
                          −{d.pctBelowListingMedian}%
                        </span>
                      ) : <span className="text-zinc-400">—</span>}
                    </td>
                    <td className="py-1.5 px-2 text-right whitespace-nowrap">
                      {d.profitGold > 0 ? (
                        <span className="text-emerald-700 dark:text-emerald-400 font-medium">+{fmt(d.profitGold)} {GOLD}</span>
                      ) : <span className="text-zinc-400">—</span>}
                    </td>
                    <td className="py-1.5 px-2 font-mono text-xs text-zinc-700 dark:text-zinc-300">
                      <span className="inline-flex items-center gap-1">
                        S{d.server} {d.coords}
                        <CopyButton text={`S${d.server} ${d.coords}`} />
                      </span>
                    </td>
                    <td className={`py-1.5 px-2 text-right whitespace-nowrap text-xs ${isHot ? 'text-red-600 dark:text-red-400 font-medium' : 'text-zinc-500'}`}>
                      {isHot && '🔥 '}{timeAgo(d.recordedAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {filtered.length > 200 && (
        <div className="text-xs text-zinc-500 text-center pt-2">
          Showing top 200 of {filtered.length}. Narrow filters to see more.
        </div>
      )}
    </div>
  );
}
