'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

interface ItemRow {
  id: string;
  name: string;
  item_level: number | null;
  median_gold_value: number | null;
  median_crystal_value: number | null;
  sample_count_gold: number | null;
  sample_count_crystal: number | null;
  image_path: string | null;
  last_history_refresh: string | null;
}

export function DiscoveredItemsList() {
  const [items, setItems] = useState<ItemRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from('items')
      .select('id, name, item_level, median_gold_value, median_crystal_value, sample_count_gold, sample_count_crystal, image_path, last_history_refresh')
      .eq('is_auto_discovered', true)
      .order('median_gold_value', { ascending: false, nullsFirst: false })
      .limit(50)
      .then(({ data, error }) => {
        if (error) console.error(error);
        setItems(data ?? []);
        setLoading(false);
      });
  }, []);

  if (loading) return <div className="text-sm text-zinc-500">Loading discovered items...</div>;
  if (items.length === 0) return <div className="text-sm text-zinc-500">No items discovered yet. Run Discovery first.</div>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-zinc-500 dark:text-zinc-400 text-xs uppercase">
          <tr>
            <th className="text-left py-2">Icon</th>
            <th className="text-left py-2">Name</th>
            <th className="text-right py-2">Median (gold)</th>
            <th className="text-right py-2">Median (crystal)</th>
            <th className="text-right py-2">Samples</th>
            <th className="text-left py-2">Last refresh</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.id} className="border-t border-zinc-200 dark:border-zinc-800">
              <td className="py-2">
                {it.image_path
                  ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={it.image_path} alt="" className="w-8 h-8 object-contain" />
                  )
                  : <div className="w-8 h-8 bg-zinc-200 dark:bg-zinc-800 rounded" />}
              </td>
              <td className="py-2 font-medium">
                {it.name}
                {it.item_level ? <span className="text-xs text-zinc-500 ml-1">(Lv{it.item_level})</span> : null}
              </td>
              <td className="py-2 text-right">
                {it.median_gold_value != null ? it.median_gold_value.toLocaleString() : '—'}
              </td>
              <td className="py-2 text-right">
                {it.median_crystal_value != null ? it.median_crystal_value.toLocaleString() : '—'}
              </td>
              <td className="py-2 text-right text-zinc-500">
                {(it.sample_count_gold ?? 0) + (it.sample_count_crystal ?? 0)}
              </td>
              <td className="py-2 text-zinc-500">
                {it.last_history_refresh ? new Date(it.last_history_refresh).toLocaleString() : 'never'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
