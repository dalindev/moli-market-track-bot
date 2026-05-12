// Pure functions for computing deal metrics from items + listings.
// No I/O. Unit tested.

export type DealConfidence = 'screaming' | 'strong' | 'modest' | 'borderline';

export interface RankedListing {
  // Identity
  snapshotId: string;
  itemId: string;
  itemName: string;
  itemType: 'item' | 'pet';
  itemLevel: number | null;
  imagePath: string | null;
  fairValueSource: string | null; // for misprice-flag handling

  // Listing
  price: number;
  pricetype: 0 | 1;
  priceGold: number;             // listing price normalized to gold
  server: number;
  stallName: string;
  stallCdkey: string;
  coords: string;
  quantity: number;
  recordedAt: string;

  // References
  fairValueGold: number | null;       // from item.fair_value_gold
  listingMedianGold: number | null;   // median of OTHER current listings for same item

  // Scoring (null when reference is null)
  pctBelowFair: number | null;
  pctBelowListingMedian: number | null;
  profitGold: number;                 // max(0, fairValueGold - priceGold) — the upside

  // Flags
  isDeal: boolean;
  isScreamingDeal: boolean;
  isMispriceCandidate: boolean;       // item has past misprice history
  confidence: DealConfidence;
}

export interface DealFinderInput {
  items: Array<{
    id: string;
    name: string;
    item_type: 'item' | 'pet';
    item_level: number | null;
    image_path: string | null;
    fair_value_gold: number | null;
    fair_value_source: string | null;
    fair_value_exchange_rate: number | null;
    median_gold_value: number | null;
    median_crystal_value: number | null;
  }>;
  snapshots: Array<{
    id: string;
    item_id: string;
    price: number;
    pricetype: number;       // 0 or 1
    server: number;
    stall_name: string;
    stall_cdkey: string;
    coords: string;
    quantity: number;
    recorded_at: string;
  }>;
  fallbackExchangeRate: number;  // when item has no fair_value_exchange_rate
  minDealPct: number;            // typically 30
  screamingDealPct: number;      // typically 50
}

export function findDeals(input: DealFinderInput): RankedListing[] {
  const itemsById = new Map(input.items.map((it) => [it.id, it]));

  // Group snapshots by item_id to compute listing median per item
  const byItemId = new Map<string, typeof input.snapshots>();
  for (const s of input.snapshots) {
    const arr = byItemId.get(s.item_id) ?? [];
    arr.push(s);
    byItemId.set(s.item_id, arr);
  }

  // Compute listing median PER item (in gold), excluding the listing being scored
  // Actually we need to compute it considering all listings of that item.
  // For each listing, pct_below_listing_median = (median_of_others - this) / median_of_others
  // For simplicity: compute median once per item using all listings, then score each.

  function toGold(s: { price: number; pricetype: number }, item: typeof input.items[number]): number {
    if (s.pricetype === 0) return s.price;
    const rate = item.fair_value_exchange_rate ?? input.fallbackExchangeRate;
    return Math.round(s.price * rate);
  }

  function median(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
      : sorted[mid];
  }

  const listingMedianByItem = new Map<string, number>();
  for (const [itemId, snaps] of byItemId) {
    const item = itemsById.get(itemId);
    if (!item) continue;
    if (snaps.length < 2) continue; // need >= 2 listings for a meaningful peer median
    const golds = snaps.map((s) => toGold(s, item));
    listingMedianByItem.set(itemId, median(golds));
  }

  const ranked: RankedListing[] = [];
  for (const s of input.snapshots) {
    const item = itemsById.get(s.item_id);
    if (!item) continue;
    const priceGold = toGold(s, item);
    const fairValueGold = item.fair_value_gold;
    const listingMedianGold = listingMedianByItem.get(item.id) ?? null;

    const pctBelowFair = fairValueGold && fairValueGold > 0
      ? Math.round(((fairValueGold - priceGold) / fairValueGold) * 100)
      : null;

    // For listing median, exclude this listing itself if it's the only sample worth comparing
    let pctBelowListingMedian: number | null = null;
    if (listingMedianGold && listingMedianGold > 0) {
      pctBelowListingMedian = Math.round(((listingMedianGold - priceGold) / listingMedianGold) * 100);
    }

    const profitGold = fairValueGold ? Math.max(0, fairValueGold - priceGold) : 0;
    const isMispriceCandidate = (item.fair_value_source ?? '').endsWith('_mismatch');

    const passFair = pctBelowFair !== null && pctBelowFair >= input.minDealPct;
    const passMedian = pctBelowListingMedian !== null && pctBelowListingMedian >= input.minDealPct;
    const isDeal = passFair || passMedian;

    const screamFair = pctBelowFair !== null && pctBelowFair >= input.screamingDealPct;
    const screamMedian = pctBelowListingMedian !== null && pctBelowListingMedian >= input.screamingDealPct;
    const isScreamingDeal = screamFair && screamMedian;

    let confidence: DealConfidence;
    if (isScreamingDeal) confidence = 'screaming';
    else if (passFair && passMedian) confidence = 'strong';
    else if (passFair || passMedian) confidence = 'modest';
    else confidence = 'borderline';

    ranked.push({
      snapshotId: s.id,
      itemId: item.id,
      itemName: item.name,
      itemType: item.item_type,
      itemLevel: item.item_level,
      imagePath: item.image_path,
      fairValueSource: item.fair_value_source,
      price: s.price,
      pricetype: s.pricetype as 0 | 1,
      priceGold,
      server: s.server,
      stallName: s.stall_name,
      stallCdkey: s.stall_cdkey,
      coords: s.coords,
      quantity: s.quantity,
      recordedAt: s.recorded_at,
      fairValueGold,
      listingMedianGold,
      pctBelowFair,
      pctBelowListingMedian,
      profitGold,
      isDeal,
      isScreamingDeal,
      isMispriceCandidate,
      confidence,
    });
  }

  return ranked.filter((r) => r.isDeal);
}

/** Sort deals: misprice candidates first, then by profit desc, then by recency. */
export function sortDeals(deals: RankedListing[]): RankedListing[] {
  return [...deals].sort((a, b) => {
    if (a.isMispriceCandidate !== b.isMispriceCandidate) {
      return a.isMispriceCandidate ? -1 : 1;
    }
    if (b.profitGold !== a.profitGold) return b.profitGold - a.profitGold;
    return new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime();
  });
}
