import type { SupabaseClient } from '@supabase/supabase-js';
import type { MarketResponse, MarketItem, MarketPet, Stall } from '@/types/market';
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

/** Updates `out` with (item_id → base_image_number) hints from a market response.
 * Only records first sighting per item — subsequent stalls with the same item are ignored. */
export function collectImageHints(
  response: MarketResponse,
  knownItems: Map<string, string>,
  out: Map<string, number>
): void {
  for (const items of Object.values(response.itemsByCd ?? {})) {
    for (const it of items as MarketItem[]) {
      const key = isGaiZaoTuLevel(it.ITEM_LEVEL)
        ? `${it.ITEM_TRUENAME}::${it.ITEM_LEVEL}`
        : `${it.ITEM_TRUENAME}::0`;
      const itemId = knownItems.get(key);
      if (itemId && it.ITEM_BASEIMAGENUMBER && !out.has(itemId)) {
        out.set(itemId, it.ITEM_BASEIMAGENUMBER);
      }
    }
  }
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
    // Step 1: Fetch all items from DB into a lookup map.
    // PostgREST caps default max_rows at 1000, so paginate explicitly.
    const knownRows: Array<{ id: string; name: string; item_type: string; item_level: number | null }> = [];
    const KNOWN_PAGE = 1000;
    let knownFrom = 0;
    for (;;) {
      const { data: pageRows, error: knownErr } = await deps.supabase
        .from('items')
        .select('id, name, item_type, item_level')
        .range(knownFrom, knownFrom + KNOWN_PAGE - 1);
      if (knownErr) throw new Error(knownErr.message);
      if (!pageRows || pageRows.length === 0) break;
      knownRows.push(...pageRows);
      if (pageRows.length < KNOWN_PAGE) break;
      knownFrom += KNOWN_PAGE;
    }

    const known = new Map<string, string>(); // key: name::item_type::level → uuid
    for (const it of knownRows) {
      const lvl = isGaiZaoTuLevel(it.item_level) ? it.item_level : 0;
      known.set(`${it.name}::${it.item_type}::${lvl}`, it.id);
    }

    // Step 2: Fetch page 1 to learn totalPages, then collect all pages
    const first = await fetchMarketPage({ page: 1 }, { signal: deps.signal });
    const totalPages = Math.ceil(first.totalFiltered / first.perPage);
    deps.onProgress({ currentPage: 1, totalPages, note: `Sweeping ${totalPages} pages...` });

    const allListings: MarketListingRow[] = [];
    const imageHints = new Map<string, number>(); // item_id → base_image_number
    const stallsByPage: MarketResponse[] = [first];

    for (let page = 2; page <= totalPages; page += 1) {
      if (deps.signal.aborted) return { status: 'aborted', itemsScanned, pricesRecorded, errorMessage: null };
      const res = await fetchMarketPage({ page }, { signal: deps.signal });
      stallsByPage.push(res);
      deps.onProgress({ currentPage: page, totalPages });
    }

    // Step 3: Pass 1 — collect unique unseen names for both items and pets
    const newKeys = new Set<string>();
    const keyToMeta = new Map<string, { name: string; item_type: 'item' | 'pet'; item_level: number | null; base_image_number: number | null }>();

    function lookupKey(name: string, type: 'item' | 'pet', level: number | null): string {
      const lvl = isGaiZaoTuLevel(level) ? level : 0;
      return `${name}::${type}::${lvl}`;
    }

    for (const pageData of stallsByPage) {
      // Items
      for (const items of Object.values(pageData.itemsByCd ?? {})) {
        for (const it of items as MarketItem[]) {
          itemsScanned += 1;
          const lvl = isGaiZaoTuLevel(it.ITEM_LEVEL) ? it.ITEM_LEVEL : null;
          const key = lookupKey(it.ITEM_TRUENAME, 'item', lvl);
          if (!known.has(key) && !newKeys.has(key)) {
            newKeys.add(key);
            keyToMeta.set(key, {
              name: it.ITEM_TRUENAME,
              item_type: 'item',
              item_level: lvl,
              base_image_number: it.ITEM_BASEIMAGENUMBER || null,
            });
          }
        }
      }
      // Pets
      for (const pets of Object.values(pageData.petsByCd ?? {})) {
        for (const pet of pets as MarketPet[]) {
          itemsScanned += 1;
          const key = lookupKey(pet.Name, 'pet', null);
          if (!known.has(key) && !newKeys.has(key)) {
            newKeys.add(key);
            keyToMeta.set(key, {
              name: pet.Name,
              item_type: 'pet',
              item_level: null,
              base_image_number: pet.BaseImgnum || null,
            });
          }
        }
      }
    }

    // Insert new items/pets in chunks of 500
    const toInsert = Array.from(keyToMeta.entries()).map(([, meta]) => ({
      name: meta.name,
      item_type: meta.item_type,
      item_level: meta.item_level,
      base_image_number: meta.base_image_number,
      is_auto_discovered: true,
    }));

    deps.onProgress({ currentPage: totalPages, totalPages, note: `Inserting ${toInsert.length} new items/pets...` });

    const INSERT_BATCH = 500;
    for (let i = 0; i < toInsert.length; i += INSERT_BATCH) {
      if (deps.signal.aborted) return { status: 'aborted', itemsScanned, pricesRecorded, errorMessage: null };
      const slice = toInsert.slice(i, i + INSERT_BATCH);
      const { data: inserted, error: insErr } = await deps.supabase
        .from('items')
        .insert(slice)
        .select('id, name, item_type, item_level');
      if (insErr) {
        console.error('[market-sweep] item insert failed:', insErr.message);
        continue;
      }
      for (const row of inserted ?? []) {
        const lvl = isGaiZaoTuLevel(row.item_level) ? row.item_level : 0;
        known.set(`${row.name}::${row.item_type}::${lvl}`, row.id);
      }
    }

    // Step 4: Build all listing rows now that every item has an item_id
    for (const pageData of stallsByPage) {
      const stallMap = new Map(pageData.stalls.map((s: Stall) => [s.cdkey, s]));
      // Items
      for (const [cdkey, items] of Object.entries(pageData.itemsByCd ?? {})) {
        const stall = stallMap.get(cdkey);
        if (!stall) continue;
        for (const it of items as MarketItem[]) {
          const lvl = isGaiZaoTuLevel(it.ITEM_LEVEL) ? it.ITEM_LEVEL : null;
          const itemId = known.get(lookupKey(it.ITEM_TRUENAME, 'item', lvl));
          if (!itemId) continue;
          allListings.push({
            item_id: itemId,
            price: it.price,
            pricetype: it.pricetype,
            server: stall.server,
            stall_name: stall.name,
            stall_cdkey: cdkey,
            coords: stall.coords,
            quantity: it.ITEM_REMAIN ?? 1,
            source: 'market',
            listing_key: `${itemId}:${cdkey}:${it.price}:${it.pricetype}`,
          });
          if (it.ITEM_BASEIMAGENUMBER && !imageHints.has(itemId)) {
            imageHints.set(itemId, it.ITEM_BASEIMAGENUMBER);
          }
        }
      }
      // Pets
      for (const [cdkey, pets] of Object.entries(pageData.petsByCd ?? {})) {
        const stall = stallMap.get(cdkey);
        if (!stall) continue;
        for (const pet of pets as MarketPet[]) {
          const itemId = known.get(lookupKey(pet.Name, 'pet', null));
          if (!itemId) continue;
          allListings.push({
            item_id: itemId,
            price: pet.price,
            pricetype: pet.pricetype,
            server: stall.server,
            stall_name: stall.name,
            stall_cdkey: cdkey,
            coords: stall.coords,
            quantity: 1,
            source: 'market',
            listing_key: `${itemId}:${cdkey}:${pet.price}:${pet.pricetype}`,
          });
          if (pet.BaseImgnum && !imageHints.has(itemId)) {
            imageHints.set(itemId, pet.BaseImgnum);
          }
        }
      }
    }

    // Step 5: Deduplicate, delete prior market snapshots, batch insert
    const dedupedRows = dedupeByListingKey(allListings);
    const duplicatesRemoved = allListings.length - dedupedRows.length;
    const sweepErrors: string[] = [];

    deps.onProgress({
      currentPage: totalPages,
      totalPages,
      note: `Built ${allListings.length} rows → ${dedupedRows.length} unique (removed ${duplicatesRemoved} dupes)`,
    });

    if (dedupedRows.length === 0) {
      sweepErrors.push(
        `No listings to insert. Built ${allListings.length} rows from market response; after dedup, 0 remain. Likely 'known' lookup never matched the live ITEM_TRUENAME — check name encoding or item_level handling.`
      );
    }

    // Delete prior market snapshots. Chunk the IN-clause to avoid PostgREST URL limits.
    const DELETE_CHUNK = 500;
    const touchedItemIds = Array.from(new Set(dedupedRows.map((r) => r.item_id)));
    for (let i = 0; i < touchedItemIds.length; i += DELETE_CHUNK) {
      const chunk = touchedItemIds.slice(i, i + DELETE_CHUNK);
      const { error: delErr } = await deps.supabase
        .from('price_snapshots')
        .delete()
        .in('item_id', chunk)
        .eq('source', 'market');
      if (delErr) {
        const msg = `delete chunk failed: ${delErr.message}`;
        console.error('[market-sweep]', msg);
        sweepErrors.push(msg);
      }
    }

    const BATCH_SIZE = 500;
    for (let i = 0; i < dedupedRows.length; i += BATCH_SIZE) {
      const slice = dedupedRows.slice(i, i + BATCH_SIZE);
      const { error } = await deps.supabase.from('price_snapshots').insert(slice);
      if (error) {
        const msg = `batch ${Math.floor(i / BATCH_SIZE) + 1} insert failed: ${error.message} (details: ${'details' in error ? (error as { details?: string }).details ?? '' : ''})`;
        console.error('[market-sweep]', msg);
        sweepErrors.push(msg);
        continue;
      }
      pricesRecorded += slice.length;
    }

    // Step 6: Fetch icons for items/pets lacking image_path, sending item_type in body
    if (imageHints.size > 0) {
      const { data: imagelessItems } = await deps.supabase
        .from('items')
        .select('id, item_type')
        .in('id', Array.from(imageHints.keys()))
        .is('image_path', null);
      for (const row of imagelessItems ?? []) {
        if (deps.signal.aborted) break;
        const num = imageHints.get(row.id);
        if (!num) continue;
        // Be polite to the image server — small jitter between fetches
        await new Promise((resolve) => setTimeout(resolve, 200 + Math.random() * 300));
        try {
          const res = await fetch('/api/save-item-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ base_image_number: num, item_type: row.item_type }),
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

    const errorSummary = sweepErrors.length > 0 ? sweepErrors.slice(0, 3).join(' | ') : null;
    deps.onProgress({
      currentPage: totalPages,
      totalPages,
      note: `Saved ${pricesRecorded} listings across ${touchedItemIds.length} items/pets.${errorSummary ? ` (${sweepErrors.length} errors — see status)` : ''}`,
    });

    // Treat as failure if we built non-zero listings but saved zero — visible to user
    const isFailure = pricesRecorded === 0 && allListings.length > 0;
    return {
      status: isFailure ? 'failed' : 'completed',
      itemsScanned,
      pricesRecorded,
      errorMessage: errorSummary ?? (isFailure ? `Built ${allListings.length} listings but saved 0 — check console for inserts errors` : null),
    };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { status: 'aborted', itemsScanned, pricesRecorded, errorMessage: null };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { status: 'failed', itemsScanned, pricesRecorded, errorMessage: msg };
  }
}
