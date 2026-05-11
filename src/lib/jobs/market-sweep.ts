import type { SupabaseClient } from '@supabase/supabase-js';
import type { MarketResponse, MarketItem, Stall } from '@/types/market';
import type { ScanRunOutcome } from '@/types/scanner';
import { fetchMarketPage } from '../api-clients/market';
import { isGaiZaoTuLevel } from '../item-level';

export interface MarketListingRow {
  item_id: string;
  price: number;
  pricetype: number;
  server: number;
  stall_name: string;
  stall_cdkey: string;
  coords: string;
  quantity: number;
  source: 'market';
  listing_key: string;
}

// Build the lookup key consistent with how we store items
function itemLookupKey(name: string, level: number | null): string {
  // For 改造圖 levels (5/6/7), use the level. Otherwise null/'' for "no level".
  if (isGaiZaoTuLevel(level)) return `${name}::${level}`;
  return `${name}::0`;
}

export function filterRelevantListings(
  response: MarketResponse,
  knownItems: Map<string, string>  // key: itemLookupKey, value: item_id (UUID)
): MarketListingRow[] {
  const stallMap = new Map(response.stalls.map((s: Stall) => [s.cdkey, s]));
  const rows: MarketListingRow[] = [];

  for (const [cdkey, items] of Object.entries(response.itemsByCd ?? {})) {
    const stall = stallMap.get(cdkey);
    if (!stall) continue;

    for (const item of items as MarketItem[]) {
      // Only persist for "no-pricetype-distinction" matching at the listing layer.
      // Items entry in our DB is keyed by name (item-level for 改造圖).
      // So we look up name+level.
      const key = itemLookupKey(item.ITEM_TRUENAME, isGaiZaoTuLevel(item.ITEM_LEVEL) ? item.ITEM_LEVEL : null);
      const itemId = knownItems.get(key);
      if (!itemId) continue;

      rows.push({
        item_id: itemId,
        price: item.price,
        pricetype: item.pricetype,
        server: stall.server,
        stall_name: stall.name,
        stall_cdkey: cdkey,
        coords: stall.coords,
        quantity: item.ITEM_REMAIN ?? 1,
        source: 'market',
        listing_key: `${itemId}:${cdkey}:${item.price}:${item.pricetype}`,
      });
    }
  }

  return rows;
}

export function dedupeByListingKey(rows: MarketListingRow[]): MarketListingRow[] {
  return Array.from(new Map(rows.map((r) => [r.listing_key, r])).values());
}

export interface MarketSweepDeps {
  supabase: SupabaseClient;
  signal: AbortSignal;
  onProgress: (update: { currentPage: number; totalPages: number; note?: string }) => void;
}

export async function runMarketSweep(deps: MarketSweepDeps): Promise<ScanRunOutcome> {
  let itemsScanned = 0;
  let pricesRecorded = 0;
  try {
    // 1) Build known-items lookup
    const { data: knownItems, error: itemsErr } = await deps.supabase
      .from('items')
      .select('id, name, item_level')
      .eq('is_auto_discovered', true);
    if (itemsErr) throw new Error(itemsErr.message);

    const known = new Map<string, string>();
    for (const it of knownItems ?? []) {
      const key = isGaiZaoTuLevel(it.item_level) ? `${it.name}::${it.item_level}` : `${it.name}::0`;
      known.set(key, it.id);
    }

    if (known.size === 0) {
      deps.onProgress({ currentPage: 0, totalPages: 0, note: 'No items in DB yet — run Discovery first.' });
      return { status: 'completed', itemsScanned: 0, pricesRecorded: 0, errorMessage: null };
    }

    // 2) Fetch page 1 to learn totalPages
    const first = await fetchMarketPage({ page: 1 }, { signal: deps.signal });
    const totalPages = Math.ceil(first.totalFiltered / first.perPage);
    deps.onProgress({ currentPage: 1, totalPages, note: `Sweeping ${totalPages} pages...` });

    const allRows: MarketListingRow[] = [];
    allRows.push(...filterRelevantListings(first, known));
    itemsScanned += Object.values(first.itemsByCd ?? {}).reduce((acc, arr) => acc + arr.length, 0);

    // 3) Remaining pages
    for (let page = 2; page <= totalPages; page += 1) {
      if (deps.signal.aborted) {
        return { status: 'aborted', itemsScanned, pricesRecorded, errorMessage: null };
      }
      const res = await fetchMarketPage({ page }, { signal: deps.signal });
      allRows.push(...filterRelevantListings(res, known));
      itemsScanned += Object.values(res.itemsByCd ?? {}).reduce((acc, arr) => acc + arr.length, 0);
      deps.onProgress({ currentPage: page, totalPages });
    }

    // 3b) Deduplicate by listing_key. A single stall can list N stacks of the same item
    // at the same price (e.g., 20 stacks of 穴熊升星金卡 at 58888 each). The unique
    // index on listing_key (WHERE source='market') would reject the whole batch otherwise.
    const dedupedRows = dedupeByListingKey(allRows);
    const duplicatesRemoved = allRows.length - dedupedRows.length;
    if (duplicatesRemoved > 0) {
      deps.onProgress({
        currentPage: totalPages,
        totalPages,
        note: `Removed ${duplicatesRemoved} duplicate stack listings`,
      });
    }

    // 4) Clear prior market snapshots for touched items (fresh view)
    const touchedItemIds = Array.from(new Set(dedupedRows.map((r) => r.item_id)));
    if (touchedItemIds.length > 0) {
      const { error: delErr } = await deps.supabase
        .from('price_snapshots')
        .delete()
        .in('item_id', touchedItemIds)
        .eq('source', 'market');
      if (delErr) console.error('[market-sweep] delete failed:', delErr.message);
    }

    // 5) Batch insert
    const BATCH_SIZE = 500;
    for (let i = 0; i < dedupedRows.length; i += BATCH_SIZE) {
      const slice = dedupedRows.slice(i, i + BATCH_SIZE);
      const { error } = await deps.supabase.from('price_snapshots').insert(slice);
      if (error) {
        console.error('[market-sweep] batch insert failed:', error.message);
        continue;
      }
      pricesRecorded += slice.length;
    }

    // 6) Fetch icons for newly known items lacking image_path.
    // We only walk the page-1 (`first`) response since one sighting per item is enough.
    const imageMap = new Map<string, number>(); // item_id -> base_image_number
    for (const items of Object.values(first.itemsByCd ?? {})) {
      for (const it of items as MarketItem[]) {
        const key = isGaiZaoTuLevel(it.ITEM_LEVEL) ? `${it.ITEM_TRUENAME}::${it.ITEM_LEVEL}` : `${it.ITEM_TRUENAME}::0`;
        const itemId = known.get(key);
        if (itemId && it.ITEM_BASEIMAGENUMBER && !imageMap.has(itemId)) {
          imageMap.set(itemId, it.ITEM_BASEIMAGENUMBER);
        }
      }
    }
    if (imageMap.size > 0) {
      const { data: imagelessItems } = await deps.supabase
        .from('items')
        .select('id')
        .in('id', Array.from(imageMap.keys()))
        .is('image_path', null);
      for (const row of imagelessItems ?? []) {
        if (deps.signal.aborted) break;
        const num = imageMap.get(row.id);
        if (!num) continue;
        try {
          const res = await fetch('/api/save-item-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ base_image_number: num }),
          });
          const data = (await res.json()) as { ok?: boolean; image_path?: string };
          if (data.ok && data.image_path) {
            await deps.supabase.from('items').update({ image_path: data.image_path }).eq('id', row.id);
          }
        } catch (e) {
          console.error('[market-sweep] image fetch failed:', e);
        }
      }
    }

    deps.onProgress({
      currentPage: totalPages,
      totalPages,
      note: `Saved ${pricesRecorded} listings across ${touchedItemIds.length} items.`,
    });

    return { status: 'completed', itemsScanned, pricesRecorded, errorMessage: null };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { status: 'aborted', itemsScanned, pricesRecorded, errorMessage: null };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { status: 'failed', itemsScanned, pricesRecorded, errorMessage: msg };
  }
}
