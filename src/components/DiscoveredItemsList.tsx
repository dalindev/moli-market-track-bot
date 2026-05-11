'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

const GOLD = '💰';
const CRYSTAL = '💎';

interface ItemRow {
  id: string;
  name: string;
  item_type: string;  // 'item' or 'pet'
  item_level: number | null;
  median_gold_value: number | null;
  median_crystal_value: number | null;
  min_sold_gold: number | null;
  min_sold_crystal: number | null;
  max_sold_gold: number | null;
  max_sold_crystal: number | null;
  sample_count_gold: number | null;
  sample_count_crystal: number | null;
  image_path: string | null;
  last_history_refresh: string | null;
  fair_value_gold: number | null;
  fair_value_source: string | null;
  fair_value_exchange_rate: number | null;
}

function fmtNum(n: number | null | undefined): string {
  if (n == null) return '—';
  return n.toLocaleString();
}

function sourceBadge(source: string | null): { label: string; cls: string } | null {
  if (!source) return null;
  switch (source) {
    case 'gold_only': return { label: `${GOLD} only`, cls: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300' };
    case 'crystal_only': return { label: `${CRYSTAL} only`, cls: 'bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300' };
    case 'gold_dominant': return { label: `${GOLD} ✓`, cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' };
    case 'crystal_dominant': return { label: `${CRYSTAL} ✓`, cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' };
    case 'gold_dominant_mismatch': return { label: `${GOLD} ⚠ misprice on ${CRYSTAL}`, cls: 'bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300' };
    case 'crystal_dominant_mismatch': return { label: `${CRYSTAL} ⚠ misprice on ${GOLD}`, cls: 'bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300' };
    case 'insufficient': return { label: 'low data', cls: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400' };
    default: return { label: source, cls: 'bg-zinc-100 text-zinc-500' };
  }
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function DiscoveredItemsList() {
  const [items, setItems] = useState<ItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<'fair' | 'gold' | 'crystal' | 'samples'>('fair');

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from('items')
      .select('id, name, item_type, item_level, median_gold_value, median_crystal_value, min_sold_gold, min_sold_crystal, max_sold_gold, max_sold_crystal, sample_count_gold, sample_count_crystal, image_path, last_history_refresh, fair_value_gold, fair_value_source, fair_value_exchange_rate')
      .eq('is_auto_discovered', true)
      .limit(200)
      .then(({ data, error }) => {
        if (error) console.error(error);
        setItems(data ?? []);
        setLoading(false);
      });
  }, []);

  if (loading) return <div className="text-sm text-zinc-500">Loading discovered items...</div>;
  if (items.length === 0) return <div className="text-sm text-zinc-500">No items discovered yet. Run Discovery first.</div>;

  const sorted = [...items].sort((a, b) => {
    switch (sortBy) {
      case 'fair': return (b.fair_value_gold ?? -1) - (a.fair_value_gold ?? -1);
      case 'gold': return (b.median_gold_value ?? -1) - (a.median_gold_value ?? -1);
      case 'crystal': return (b.median_crystal_value ?? -1) - (a.median_crystal_value ?? -1);
      case 'samples': return ((b.sample_count_gold ?? 0) + (b.sample_count_crystal ?? 0)) - ((a.sample_count_gold ?? 0) + (a.sample_count_crystal ?? 0));
    }
  });

  const Th = ({ label, k }: { label: string; k?: typeof sortBy }) => (
    <th className={`text-left py-2 px-2 font-medium text-zinc-500 dark:text-zinc-400 text-xs uppercase tracking-wide ${k ? 'cursor-pointer hover:text-zinc-900 dark:hover:text-zinc-100' : ''}`}
        onClick={k ? () => setSortBy(k) : undefined}>
      {label}{k && sortBy === k ? ' ▾' : ''}
    </th>
  );

  return (
    <div className="overflow-x-auto -mx-4 sm:mx-0">
      <table className="w-full text-sm">
        <thead className="bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800">
          <tr>
            <Th label="" />
            <Th label="Name" />
            <Th label="Fair value" k="fair" />
            <Th label={`${GOLD} Gold`} k="gold" />
            <Th label={`${CRYSTAL} Crystal`} k="crystal" />
            <Th label="Samples" k="samples" />
            <Th label="Quality" />
            <Th label="Refreshed" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((it) => {
            const badge = sourceBadge(it.fair_value_source);
            return (
              <tr key={it.id} className="border-t border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
                <td className="py-2 px-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {it.image_path
                    ? <img src={it.image_path} alt="" className="w-8 h-8 object-contain" />
                    : <div className="w-8 h-8 bg-zinc-100 dark:bg-zinc-800 rounded" />}
                </td>
                <td className="py-2 px-2">
                  <div className="font-medium text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                    {it.name}
                    {it.item_type === 'pet' && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-pink-100 text-pink-700 dark:bg-pink-950 dark:text-pink-300">
                        pet
                      </span>
                    )}
                  </div>
                  {it.item_level != null && it.item_level > 0
                    ? <div className="text-xs text-zinc-500">Lv{it.item_level}</div>
                    : null}
                </td>
                <td className="py-2 px-2">
                  <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                    {fmtNum(it.fair_value_gold)} {GOLD}
                  </div>
                  {it.fair_value_gold != null && it.fair_value_exchange_rate
                    ? (
                      <div className="text-sm text-zinc-600 dark:text-zinc-400">
                        {fmtNum(Math.round(it.fair_value_gold / it.fair_value_exchange_rate))} {CRYSTAL}
                      </div>
                    )
                    : null}
                  {it.fair_value_exchange_rate
                    ? <div className="text-xs text-zinc-500">@ {it.fair_value_exchange_rate}/c</div>
                    : null}
                </td>
                <td className="py-2 px-2 text-zinc-700 dark:text-zinc-300">
                  <div>{fmtNum(it.median_gold_value)}</div>
                  <div className="text-xs text-zinc-500">
                    n={it.sample_count_gold ?? 0}
                    {it.min_sold_gold != null && it.max_sold_gold != null && (it.sample_count_gold ?? 0) > 1
                      ? ` · ${fmtNum(it.min_sold_gold)}-${fmtNum(it.max_sold_gold)}`
                      : ''}
                  </div>
                </td>
                <td className="py-2 px-2 text-zinc-700 dark:text-zinc-300">
                  <div>{fmtNum(it.median_crystal_value)}</div>
                  <div className="text-xs text-zinc-500">
                    n={it.sample_count_crystal ?? 0}
                    {it.min_sold_crystal != null && it.max_sold_crystal != null && (it.sample_count_crystal ?? 0) > 1
                      ? ` · ${fmtNum(it.min_sold_crystal)}-${fmtNum(it.max_sold_crystal)}`
                      : ''}
                  </div>
                </td>
                <td className="py-2 px-2 text-zinc-600 dark:text-zinc-400">
                  {(it.sample_count_gold ?? 0) + (it.sample_count_crystal ?? 0)}
                </td>
                <td className="py-2 px-2">
                  {badge && (
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${badge.cls}`}>
                      {badge.label}
                    </span>
                  )}
                </td>
                <td className="py-2 px-2 text-xs text-zinc-500">
                  {timeAgo(it.last_history_refresh)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
