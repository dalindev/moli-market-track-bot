'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useMarket } from '@/hooks/useMarket';
import { useExchangeRate } from '@/hooks/useExchangeRate';
import {
  parseEnchantStoneName,
  ENCHANT_STONES,
  ENCHANT_STAT_SLOTS,
  HIGH_VALUE_STATS,
  type EnchantStone,
  type EnchantStat,
} from '@/data/enchant-stones';
import {
  fairCrystalPrice,
  discountPercent,
  DEFAULT_ANCHOR_CRYSTAL,
  MIN_STONE_LEVEL,
  MAX_STONE_LEVEL,
} from '@/lib/enchant-fair-price';

// localStorage-backed numeric settings via useSyncExternalStore (SSR-safe, no hydration mismatch).
// Snapshot returns 0 when unset so callers can fall back to their own default.
function createStoredNumber(key: string) {
  const eventName = `stored-number:${key}`;
  return {
    snapshot(): number {
      const stored = Number(localStorage.getItem(key));
      return Number.isFinite(stored) && stored > 0 ? stored : 0;
    },
    subscribe(cb: () => void): () => void {
      window.addEventListener('storage', cb);
      window.addEventListener(eventName, cb);
      return () => {
        window.removeEventListener('storage', cb);
        window.removeEventListener(eventName, cb);
      };
    },
    store(value: number) {
      if (Number.isFinite(value) && value > 0) {
        localStorage.setItem(key, String(value));
        window.dispatchEvent(new Event(eventName));
      }
    },
  };
}

const anchorStore = createStoredNumber('enchant-stones-anchor-crystal');
const rateStore = createStoredNumber('enchant-stones-rate-override');
const zeroSnapshot = () => 0;
const DEFAULT_MIN_DISCOUNT_PCT = 20;
const SCREAMING_DISCOUNT_PCT = 50;

const GOLD = '💰';
const CRYSTAL = '💎';

const STATS: EnchantStat[] = ['防禦', '敏捷', '生命', '魔力', '攻擊', '回復', '精神'];

type ServerFilter = 'all' | '1' | '2' | '3' | '4' | '5';
type StatFilter = 'all' | EnchantStat;

interface StoneRow {
  key: string;
  stone: EnchantStone;
  price: number;
  pricetype: number;
  goldEq: number;
  fairCrystal: number;
  fairGold: number;
  discount: number; // percent below fair (negative = overpriced)
  quantity: number;
  listingCount: number;
  server: number;
  stallName: string;
  coords: string;
}

function fmt(n: number | null | undefined): string {
  if (n == null) return '—';
  return Math.round(n).toLocaleString();
}

// Badge colors follow the guide's icon tiers: lv1-6 gold, lv7-9 blue, lv10 red
function levelBadgeClass(level: number): string {
  if (level >= 10) {
    return 'bg-red-100 text-red-700 border-red-300 dark:bg-red-950 dark:text-red-300 dark:border-red-800';
  }
  if (level >= 7) {
    return 'bg-sky-100 text-sky-700 border-sky-300 dark:bg-sky-950 dark:text-sky-300 dark:border-sky-800';
  }
  return 'bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800';
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

export function EnchantStonesView() {
  const { matchingItems, loading, loadingMore, error, search, progress, hasMore, loadMore, retry, failedPages } = useMarket();
  const { currentRate, DEFAULT_GOLD_PER_CRYSTAL } = useExchangeRate();

  const storedAnchor = useSyncExternalStore(anchorStore.subscribe, anchorStore.snapshot, zeroSnapshot);
  const anchor = storedAnchor || DEFAULT_ANCHOR_CRYSTAL;
  // Manual rate override wins; otherwise follow the app-wide live rate
  const storedRate = useSyncExternalStore(rateStore.subscribe, rateStore.snapshot, zeroSnapshot);
  const rate = storedRate || currentRate?.goldPerCrystal || DEFAULT_GOLD_PER_CRYSTAL;
  const toGold = useCallback((crystal: number) => Math.round(crystal * rate), [rate]);
  const [minPct, setMinPct] = useState(DEFAULT_MIN_DISCOUNT_PCT);
  const [showAll, setShowAll] = useState(false);
  const [serverFilter, setServerFilter] = useState<ServerFilter>('all');
  const [statFilter, setStatFilter] = useState<StatFilter>('all');
  const [levelFilter, setLevelFilter] = useState<number>(0); // 0 = all

  // Search 附魔石 once on mount
  const searchedRef = useRef(false);
  useEffect(() => {
    if (searchedRef.current) return;
    searchedRef.current = true;
    void search({ search: '附魔石', type: '道具攤位', server: 'all', exact: false });
  }, [search]);

  // Keep loading pages until every listing is fetched
  useEffect(() => {
    if (!loading && !loadingMore && hasMore) void loadMore();
  }, [loading, loadingMore, hasMore, loadMore]);

  const stoneByStatLevel = useMemo(
    () => new Map(ENCHANT_STONES.map(s => [`${s.stat}-${s.level}`, s])),
    []
  );

  const { rows, unknownNames, belowFairCount } = useMemo(() => {
    const grouped = new Map<string, StoneRow>();
    const unknown = new Map<string, number>();

    for (const item of matchingItems) {
      const stone = parseEnchantStoneName(item.name);
      if (!stone) {
        unknown.set(item.name, (unknown.get(item.name) ?? 0) + 1);
        continue;
      }

      const fairCrystal = fairCrystalPrice(stone.level, anchor);
      if (fairCrystal == null) continue;
      const fairGold = toGold(fairCrystal);
      const goldEq = item.pricetype === 1 ? toGold(item.price) : item.price;
      // Crystal listings compare in crystal so the discount is exchange-rate independent
      const discount = item.pricetype === 1
        ? discountPercent(item.price, fairCrystal)
        : discountPercent(item.price, fairGold);
      if (discount == null) continue;

      const quantity = item.itemData?.ITEM_REMAIN ?? 1;
      const key = `${item.name}|${item.price}|${item.pricetype}|${item.stall.cdkey}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.quantity += quantity;
        existing.listingCount += 1;
      } else {
        grouped.set(key, {
          key,
          stone,
          price: item.price,
          pricetype: item.pricetype,
          goldEq,
          fairCrystal,
          fairGold,
          discount,
          quantity,
          listingCount: 1,
          server: item.stall.server,
          stallName: item.stall.name,
          coords: item.stall.coords,
        });
      }
    }

    const all = [...grouped.values()].sort((a, b) => b.discount - a.discount);
    return {
      rows: all,
      unknownNames: unknown,
      belowFairCount: all.filter(r => r.discount > 0).length,
    };
  }, [matchingItems, anchor, toGold]);

  const visibleRows = rows.filter(r => {
    if (!showAll && r.discount < minPct) return false;
    if (serverFilter !== 'all' && r.server !== Number(serverFilter)) return false;
    if (statFilter !== 'all' && r.stone.stat !== statFilter) return false;
    if (levelFilter !== 0 && r.stone.level !== levelFilter) return false;
    return true;
  });

  const isFetching = loading || loadingMore || hasMore;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">附魔石撿漏</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            公道價：1級 = {anchor} {CRYSTAL}，每升 1 級翻倍（2 顆合成 1 顆） ・ 匯率 1{CRYSTAL} ≈ {fmt(rate)}{GOLD}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/" className="text-sm text-blue-600 dark:text-blue-400 hover:underline">
            ← 回主頁
          </Link>
          <button
            onClick={() => {
              searchedRef.current = true;
              void search({ search: '附魔石', type: '道具攤位', server: 'all', exact: false });
            }}
            disabled={isFetching}
            className="text-sm px-3 py-1.5 rounded-md bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 disabled:opacity-50"
          >
            {isFetching ? '更新中…' : '重新整理'}
          </button>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-end gap-3 p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <label className="text-sm">
          <span className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">1級公道價（{CRYSTAL}）</span>
          <input
            type="number"
            min={1}
            value={anchor}
            onChange={e => anchorStore.store(Number(e.target.value))}
            className="w-24 px-2 py-1 rounded border border-zinc-300 dark:border-zinc-700 bg-transparent"
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">匯率（1{CRYSTAL} = ?{GOLD}）</span>
          <input
            type="number"
            min={1}
            value={rate}
            onChange={e => rateStore.store(Number(e.target.value))}
            className="w-24 px-2 py-1 rounded border border-zinc-300 dark:border-zinc-700 bg-transparent"
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">低於公道價至少 {minPct}%</span>
          <input
            type="range"
            min={0}
            max={90}
            step={5}
            value={minPct}
            onChange={e => setMinPct(Number(e.target.value))}
            className="w-36"
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">伺服器</span>
          <select
            value={serverFilter}
            onChange={e => setServerFilter(e.target.value as ServerFilter)}
            className="px-2 py-1 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900"
          >
            <option value="all">全部</option>
            {[1, 2, 3, 4, 5].map(s => <option key={s} value={String(s)}>S{s}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">屬性</span>
          <select
            value={statFilter}
            onChange={e => setStatFilter(e.target.value as StatFilter)}
            className="px-2 py-1 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900"
          >
            <option value="all">全部</option>
            {STATS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">等級</span>
          <select
            value={levelFilter}
            onChange={e => setLevelFilter(Number(e.target.value))}
            className="px-2 py-1 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900"
          >
            <option value={0}>全部</option>
            {Array.from({ length: MAX_STONE_LEVEL - MIN_STONE_LEVEL + 1 }, (_, i) => i + 1).map(lv => (
              <option key={lv} value={lv}>{lv} 級</option>
            ))}
          </select>
        </label>
        <label className="text-sm flex items-center gap-1.5 pb-1">
          <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} />
          顯示全部（含高於公道價）
        </label>
      </div>

      {/* Fair price reference table (mirrors the guide's stone grid) */}
      <details open className="text-sm text-zinc-600 dark:text-zinc-400">
        <summary className="cursor-pointer select-none font-medium">
          各級公道價一覽 <span className="text-xs font-normal">（⭐ = 高價值稀有屬性，實際成交常高於公道價）</span>
        </summary>
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800 mt-2">
          <table className="w-full text-sm">
            <thead className="bg-zinc-100 dark:bg-zinc-900">
              <tr>
                <th className="px-3 py-2 text-left font-medium whitespace-nowrap">等級 / 公道價</th>
                {STATS.map(stat => {
                  const highValue = HIGH_VALUE_STATS.has(stat);
                  return (
                    <th
                      key={stat}
                      className={`px-3 py-2 text-center font-medium whitespace-nowrap ${
                        highValue
                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300'
                          : 'text-zinc-600 dark:text-zinc-400'
                      }`}
                    >
                      {highValue && '⭐ '}{stat}加成
                      <span className="block text-xs font-normal opacity-75">限{ENCHANT_STAT_SLOTS[stat]}</span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800 bg-white dark:bg-zinc-950">
              {Array.from({ length: 10 }, (_, i) => i + 1).map(lv => {
                const c = fairCrystalPrice(lv, anchor)!;
                return (
                  <tr key={lv}>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className={`px-1.5 py-0.5 rounded border text-xs font-medium ${levelBadgeClass(lv)}`}>
                        Lv{lv}
                      </span>
                      <span className="block text-xs mt-1 text-zinc-500 dark:text-zinc-400">
                        {fmt(c)}{CRYSTAL} / {fmt(toGold(c))}{GOLD}
                      </span>
                    </td>
                    {STATS.map(stat => {
                      const stone = stoneByStatLevel.get(`${stat}-${lv}`);
                      if (!stone) return <td key={stat} />;
                      return (
                        <td
                          key={stat}
                          className={`px-3 py-2 text-center whitespace-nowrap ${
                            HIGH_VALUE_STATS.has(stat) ? 'bg-amber-50/70 dark:bg-amber-950/30' : ''
                          }`}
                        >
                          <span className="font-medium text-zinc-900 dark:text-zinc-100">【{stone.stoneName}】</span>
                          <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                            {stone.stat}+{stone.min}~{stone.max}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>

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
          <span>
            掃描市場中…{progress ? ` 第 ${progress.current}/${progress.total} 頁` : ''}（{matchingItems.length} 筆附魔石）
          </span>
        )}
        {!error && !isFetching && (
          <span>
            共 {rows.length} 筆附魔石掛售，其中 {belowFairCount} 筆低於公道價
            {unknownNames.size > 0 && `，${[...unknownNames.values()].reduce((a, b) => a + b, 0)} 筆無法辨識等級`}
            {failedPages > 0 && (
              <span className="text-amber-600 dark:text-amber-400">
                {' '}・ {failedPages} 頁讀取失敗，結果可能不完整
              </span>
            )}
          </span>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-100 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400">
            <tr>
              <th className="text-left px-3 py-2 font-medium">附魔石</th>
              <th className="text-right px-3 py-2 font-medium">售價</th>
              <th className="text-right px-3 py-2 font-medium">金幣等值</th>
              <th className="text-right px-3 py-2 font-medium">公道價</th>
              <th className="text-right px-3 py-2 font-medium">低於公道</th>
              <th className="text-right px-3 py-2 font-medium">數量</th>
              <th className="text-left px-3 py-2 font-medium">位置</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800 bg-white dark:bg-zinc-950">
            {visibleRows.map(row => {
              const screaming = row.discount >= SCREAMING_DISCOUNT_PCT;
              const overpriced = row.discount < 0;
              return (
                <tr
                  key={row.key}
                  className={
                    screaming
                      ? 'bg-emerald-50 dark:bg-emerald-950/40'
                      : overpriced
                        ? 'opacity-50'
                        : ''
                  }
                >
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2 whitespace-nowrap">
                      <span className={`px-1.5 py-0.5 rounded border text-xs font-medium ${levelBadgeClass(row.stone.level)}`}>
                        Lv{row.stone.level}
                      </span>
                      <span className="font-medium text-zinc-900 dark:text-zinc-100">{row.stone.fullName}</span>
                    </div>
                    <div className={`text-xs mt-0.5 whitespace-nowrap ${
                      HIGH_VALUE_STATS.has(row.stone.stat)
                        ? 'text-amber-600 dark:text-amber-400 font-medium'
                        : 'text-zinc-500 dark:text-zinc-400'
                    }`}>
                      {HIGH_VALUE_STATS.has(row.stone.stat) && '⭐ '}
                      {row.stone.stat}+{row.stone.min}~{row.stone.max} ・ 限{row.stone.slot}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {fmt(row.price)} {row.pricetype === 1 ? CRYSTAL : GOLD}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{fmt(row.goldEq)} {GOLD}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap text-zinc-500 dark:text-zinc-400">
                    {fmt(row.fairCrystal)}{CRYSTAL} / {fmt(row.fairGold)}{GOLD}
                  </td>
                  <td className={`px-3 py-2 text-right whitespace-nowrap font-semibold ${
                    screaming
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : row.discount > 0
                        ? 'text-emerald-700 dark:text-emerald-500'
                        : 'text-red-600 dark:text-red-400'
                  }`}>
                    {row.discount >= 0 ? `↓${row.discount.toFixed(0)}%` : `↑${Math.abs(row.discount).toFixed(0)}%`}
                    {screaming && ' 🔥'}
                  </td>
                  <td className="px-3 py-2 text-right">{row.quantity}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1 whitespace-nowrap">
                      <span className="font-medium">S{row.server}</span>
                      <span className="text-zinc-500 dark:text-zinc-400">{row.coords}</span>
                      <CopyButton text={`S${row.server} ${row.coords}`} />
                    </div>
                    <div className="text-xs text-zinc-500 dark:text-zinc-400">{row.stallName}</div>
                  </td>
                </tr>
              );
            })}
            {visibleRows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-zinc-500 dark:text-zinc-400">
                  {isFetching
                    ? '掃描中…'
                    : rows.length > 0
                      ? `沒有低於公道價 ${minPct}% 的掛售 — 可勾選「顯示全部」查看所有掛售`
                      : '目前市場上沒有附魔石掛售'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Unrecognized listings */}
      {unknownNames.size > 0 && (
        <details className="text-sm text-zinc-500 dark:text-zinc-400">
          <summary className="cursor-pointer select-none">無法辨識等級的附魔石（{unknownNames.size} 種）</summary>
          <ul className="mt-2 list-disc list-inside">
            {[...unknownNames.entries()].map(([name, count]) => (
              <li key={name}>{name} × {count}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
