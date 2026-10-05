'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useMarket } from '@/hooks/useMarket';
import { assessGear, gearTierLabel, type GearQuality, type GearTier } from '@/lib/gear-quality';
import { EQUIPMENT_DATA_VERSION } from '@/data/equipment-stats';

const GOLD = '💰';
const CRYSTAL = '💎';

type ServerFilter = 'all' | '1' | '2' | '3' | '4' | '5';
type TierFilter = 'break' | 'peak+' | 'high+' | 'all';

interface GearRow {
  key: string;
  name: string;
  price: number;
  pricetype: number;
  server: number;
  stallName: string;
  coords: string;
  quality: GearQuality;
}

const TIER_ORDER: Record<GearTier, number> = {
  break: 0, peak: 1, high: 2, normal: 3, low: 4, unknown: 5,
};

function tierClass(tier: GearTier): string {
  switch (tier) {
    case 'break':
      return 'bg-red-100 text-red-700 border-red-300 dark:bg-red-950 dark:text-red-300 dark:border-red-800 font-bold';
    case 'peak':
      return 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800 font-semibold';
    case 'high':
      return 'bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800';
    case 'low':
      return 'bg-zinc-100 text-zinc-500 border-zinc-300 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700';
    default:
      return 'bg-zinc-100 text-zinc-600 border-zinc-300 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700';
  }
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString();
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
      className="text-xs px-1.5 py-0.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-500"
      title="複製伺服器與座標"
    >
      {copied ? '✓' : '📋'}
    </button>
  );
}

export function GearQualityView() {
  const { matchingItems, loading, loadingMore, error, search, progress, hasMore, loadMore, retry, failedPages } = useMarket();

  const [keyword, setKeyword] = useState('');
  const [tierFilter, setTierFilter] = useState<TierFilter>('peak+');
  const [fullDurOnly, setFullDurOnly] = useState(false);
  const [serverFilter, setServerFilter] = useState<ServerFilter>('all');

  const runSearch = useCallback((term: string) => {
    void search({ search: term, type: 'item', server: 'all', exact: false });
  }, [search]);

  // Scan the market once on mount. Deliberately NOT auto-paginating to the end: an unfiltered
  // sweep is ~114 pages and reliably trips the upstream's 429 rate_limited.
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    runSearch('');
  }, [runSearch]);

  const rows = useMemo(() => {
    const out: GearRow[] = [];
    for (const item of matchingItems) {
      if (item.isPet || !item.itemData) continue;
      const quality = assessGear({ ...item.itemData, name: item.name });
      if (!quality.known) continue;
      out.push({
        key: `${item.name}|${item.stall.cdkey}|${item.price}|${item.itemData.ITEM_UNIQUECODE ?? ''}`,
        name: item.name,
        price: item.price,
        pricetype: item.pricetype,
        server: item.stall.server,
        stallName: item.stall.name,
        coords: item.stall.coords,
        quality,
      });
    }
    out.sort((a, b) => {
      const t = TIER_ORDER[a.quality.tier] - TIER_ORDER[b.quality.tier];
      if (t !== 0) return t;
      return (b.quality.rollPct ?? 0) - (a.quality.rollPct ?? 0);
    });
    return out;
  }, [matchingItems]);

  const visible = rows.filter((r) => {
    const t = r.quality.tier;
    if (tierFilter === 'break' && t !== 'break') return false;
    if (tierFilter === 'peak+' && !(t === 'break' || t === 'peak')) return false;
    if (tierFilter === 'high+' && !(t === 'break' || t === 'peak' || t === 'high')) return false;
    if (fullDurOnly && !r.quality.isFullDurability) return false;
    if (serverFilter !== 'all' && r.server !== Number(serverFilter)) return false;
    return true;
  });

  const breakCount = rows.filter((r) => r.quality.tier === 'break').length;
  const peakCount = rows.filter((r) => r.quality.tier === 'peak').length;
  const isFetching = loading || loadingMore;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">裝備品質掃描</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            <span className="text-red-600 dark:text-red-400 font-semibold">破頂</span> = 能力值超過上限（稀有，價值遠高於同名裝備）・
            <span className="text-amber-700 dark:text-amber-400 font-semibold"> 頂</span> = 剛好滿值
            <span className="text-zinc-400"> ・ 裝備資料 {EQUIPMENT_DATA_VERSION}</span>
          </p>
        </div>
        <Link href="/" className="text-sm text-blue-600 dark:text-blue-400 hover:underline">← 回主頁</Link>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-end gap-3 p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => { e.preventDefault(); runSearch(keyword.trim()); }}
        >
          <label className="text-sm">
            <span className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">搜尋裝備（留空 = 掃全場）</span>
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="例如：新月斧"
              className="w-44 px-2 py-1 rounded border border-zinc-300 dark:border-zinc-700 bg-transparent"
            />
          </label>
          <button
            type="submit"
            disabled={isFetching}
            className="text-sm px-3 py-1.5 rounded-md bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 disabled:opacity-50"
          >
            {isFetching ? '掃描中…' : '掃描'}
          </button>
        </form>

        <div className="h-8 w-px bg-zinc-200 dark:bg-zinc-800" />

        <label className="text-sm">
          <span className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">品質</span>
          <select
            value={tierFilter}
            onChange={(e) => setTierFilter(e.target.value as TierFilter)}
            className="px-2 py-1 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900"
          >
            <option value="break">只看 破頂</option>
            <option value="peak+">破頂 + 頂</option>
            <option value="high+">破頂 + 頂 + 高檔</option>
            <option value="all">全部</option>
          </select>
        </label>

        <label className="text-sm">
          <span className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">伺服器</span>
          <select
            value={serverFilter}
            onChange={(e) => setServerFilter(e.target.value as ServerFilter)}
            className="px-2 py-1 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900"
          >
            <option value="all">全部</option>
            {[1, 2, 3, 4, 5].map((s) => <option key={s} value={String(s)}>S{s}</option>)}
          </select>
        </label>

        <label className="text-sm flex items-center gap-1.5 pb-1">
          <input type="checkbox" checked={fullDurOnly} onChange={(e) => setFullDurOnly(e.target.checked)} />
          耐久滿
        </label>

        {hasMore && (
          <button
            onClick={() => void loadMore()}
            disabled={isFetching}
            className="ml-auto text-sm px-3 py-1.5 rounded border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
            title="上游有流量限制，每次多掃 5 頁"
          >
            繼續掃描更多攤位
          </button>
        )}
      </div>

      {/* Status */}
      <div className="text-sm text-zinc-500 dark:text-zinc-400">
        {error && (
          <span className="inline-flex items-center gap-2 text-red-600 dark:text-red-400">
            讀取失敗：{error}
            <button
              onClick={() => void retry()}
              disabled={isFetching}
              className="px-2 py-0.5 rounded border border-red-300 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-950 disabled:opacity-50"
            >
              重試
            </button>
          </span>
        )}
        {!error && isFetching && (
          <span>掃描市場中…{progress ? ` 第 ${progress.current}/${progress.total} 頁` : ''}（已辨識 {rows.length} 件裝備）</span>
        )}
        {!error && !isFetching && (
          <span>
            已辨識 {rows.length} 件裝備，其中{' '}
            <span className="text-red-600 dark:text-red-400 font-semibold">{breakCount} 件破頂</span>、
            <span className="text-amber-700 dark:text-amber-400 font-semibold">{peakCount} 件頂</span>
            {failedPages > 0 && (
              <span className="text-amber-600 dark:text-amber-400">　・ {failedPages} 頁讀取失敗，結果可能不完整</span>
            )}
          </span>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-100 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400">
            <tr>
              <th className="text-left px-3 py-2 font-medium">品質</th>
              <th className="text-left px-3 py-2 font-medium">裝備</th>
              <th className="text-right px-3 py-2 font-medium">售價</th>
              <th className="text-left px-3 py-2 font-medium">能力值</th>
              <th className="text-right px-3 py-2 font-medium">總檔</th>
              <th className="text-right px-3 py-2 font-medium">耐久</th>
              <th className="text-left px-3 py-2 font-medium">位置</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800 bg-white dark:bg-zinc-950">
            {visible.slice(0, 300).map((r) => {
              const q = r.quality;
              return (
                <tr key={r.key} className={q.tier === 'break' ? 'bg-red-50/60 dark:bg-red-950/20' : undefined}>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className={`px-1.5 py-0.5 rounded border text-xs ${tierClass(q.tier)}`}>
                      {q.tier === 'break' && '💥 '}{gearTierLabel(q.tier)}
                    </span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap font-medium text-zinc-900 dark:text-zinc-100">
                    {r.name}
                    {q.level != null && <span className="ml-1 text-xs text-zinc-500">Lv{q.level}</span>}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap font-semibold">
                    {fmt(r.price)} {r.pricetype === 0 ? GOLD : CRYSTAL}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {q.stats.map((s) => (
                      <span
                        key={s.key}
                        className={`inline-block mr-2 whitespace-nowrap ${
                          s.overBy > 0
                            ? 'text-red-600 dark:text-red-400 font-bold'
                            : s.overBy === 0
                            ? 'text-amber-700 dark:text-amber-400 font-medium'
                            : 'text-zinc-600 dark:text-zinc-400'
                        }`}
                        title={s.min != null ? `範圍 ${s.min}~${s.max}` : `上限 ${s.max}`}
                      >
                        {s.label} {s.actual}/{s.max}
                        {s.overBy > 0 && ` (+${s.overBy})`}
                      </span>
                    ))}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {q.rollPct != null ? `${q.rollPct}%` : '—'}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap text-xs">
                    {q.durabilityPct == null ? (
                      <span className="text-zinc-400">—</span>
                    ) : (
                      <span
                        className={
                          q.durabilityPct < 25
                            ? 'text-red-600 dark:text-red-400 font-bold'
                            : q.durabilityPct < 50
                            ? 'text-orange-600 dark:text-orange-400'
                            : q.isFullDurability
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-zinc-600 dark:text-zinc-400'
                        }
                      >
                        {q.durability}/{q.maxDurability}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-zinc-700 dark:text-zinc-300 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1">
                      S{r.server} {r.coords}
                      <CopyButton text={`S${r.server} ${r.coords}`} />
                    </span>
                  </td>
                </tr>
              );
            })}
            {visible.length === 0 && !isFetching && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-zinc-500">
                  這批攤位沒有符合條件的裝備。放寬「品質」篩選，或按「繼續掃描更多攤位」。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {visible.length > 300 && (
        <div className="text-xs text-zinc-500 text-center">顯示前 300 筆，共 {visible.length} 筆。</div>
      )}
    </div>
  );
}
