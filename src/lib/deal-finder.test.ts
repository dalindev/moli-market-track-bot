import { describe, it, expect } from 'vitest';
import { findDeals, sortDeals } from './deal-finder';

const RATE = 250;
const baseInput = {
  fallbackExchangeRate: RATE,
  minDealPct: 30,
  screamingDealPct: 50,
};

function makeItem(o: Partial<typeof baseItem>) {
  return { ...baseItem, ...o };
}
const baseItem = {
  id: 'i1',
  name: 'test',
  item_type: 'item' as const,
  item_level: null,
  image_path: null,
  fair_value_gold: null as number | null,
  fair_value_source: null as string | null,
  fair_value_exchange_rate: null as number | null,
  median_gold_value: null as number | null,
  median_crystal_value: null as number | null,
};

function makeSnap(o: Partial<typeof baseSnap>) {
  return { ...baseSnap, ...o };
}
const baseSnap = {
  id: 's1',
  item_id: 'i1',
  price: 100,
  pricetype: 0 as number,
  server: 1,
  stall_name: 'Stall',
  stall_cdkey: 'AAA_1',
  coords: 'x',
  quantity: 1,
  recorded_at: '2026-05-12T00:00:00Z',
};

describe('findDeals', () => {
  it('returns no deals when no listings', () => {
    expect(findDeals({ ...baseInput, items: [], snapshots: [] })).toEqual([]);
  });

  it('flags a listing 50% below fair value', () => {
    const items = [makeItem({ fair_value_gold: 100_000 })];
    const snapshots = [makeSnap({ price: 40_000 })];
    const out = findDeals({ ...baseInput, items, snapshots });
    expect(out).toHaveLength(1);
    expect(out[0].pctBelowFair).toBe(60);
    expect(out[0].isDeal).toBe(true);
    expect(out[0].isScreamingDeal).toBe(false); // listing median is null (single listing)
  });

  it('flags a listing 99% below listing-median even without fair value', () => {
    // 5 listings: four at 50k, one at 9 — the 9 is a misprice
    const items = [makeItem({ id: 'i1', fair_value_gold: null })];
    const snapshots = [
      makeSnap({ id: 's1', price: 50_000 }),
      makeSnap({ id: 's2', price: 50_000 }),
      makeSnap({ id: 's3', price: 50_000 }),
      makeSnap({ id: 's4', price: 50_000 }),
      makeSnap({ id: 's5', price: 9 }),
    ];
    const out = findDeals({ ...baseInput, items, snapshots });
    expect(out).toHaveLength(1);
    expect(out[0].snapshotId).toBe('s5');
    expect(out[0].pctBelowListingMedian).toBeGreaterThanOrEqual(99);
    expect(out[0].pctBelowFair).toBeNull();
  });

  it('marks SCREAMING deal when both references exceed screamingDealPct', () => {
    const items = [makeItem({ id: 'i1', fair_value_gold: 100_000 })];
    const snapshots = [
      makeSnap({ id: 's1', price: 100_000 }),
      makeSnap({ id: 's2', price: 100_000 }),
      makeSnap({ id: 's3', price: 100 }), // 99.9% below both fair and median
    ];
    const out = findDeals({ ...baseInput, items, snapshots });
    const screamer = out.find((r) => r.snapshotId === 's3');
    expect(screamer?.isScreamingDeal).toBe(true);
    expect(screamer?.confidence).toBe('screaming');
  });

  it('does not flag listings priced near fair value', () => {
    const items = [makeItem({ fair_value_gold: 100_000 })];
    const snapshots = [makeSnap({ price: 95_000 })]; // 5% below
    expect(findDeals({ ...baseInput, items, snapshots })).toEqual([]);
  });

  it('converts crystal listings using fair_value_exchange_rate when present, else fallback', () => {
    const items = [
      makeItem({ id: 'i1', fair_value_gold: 100_000, fair_value_exchange_rate: 300 }),
      makeItem({ id: 'i2', fair_value_gold: 100_000, fair_value_exchange_rate: null }),
    ];
    const snapshots = [
      makeSnap({ id: 's1', item_id: 'i1', price: 100, pricetype: 1 }), // 100 * 300 = 30k → 70% below
      makeSnap({ id: 's2', item_id: 'i2', price: 100, pricetype: 1 }), // 100 * 250 = 25k → 75% below
    ];
    const out = findDeals({ ...baseInput, items, snapshots });
    expect(out).toHaveLength(2);
    expect(out.find((r) => r.snapshotId === 's1')?.priceGold).toBe(30_000);
    expect(out.find((r) => r.snapshotId === 's2')?.priceGold).toBe(25_000);
  });

  it('flags isMispriceCandidate when fair_value_source ends with _mismatch', () => {
    const items = [makeItem({ fair_value_gold: 100_000, fair_value_source: 'crystal_dominant_mismatch' })];
    const snapshots = [makeSnap({ price: 50_000 })];
    const out = findDeals({ ...baseInput, items, snapshots });
    expect(out[0].isMispriceCandidate).toBe(true);
  });
});

describe('sortDeals', () => {
  it('puts misprice candidates first', () => {
    const a = makeRanked({ snapshotId: 'a', profitGold: 100, isMispriceCandidate: false });
    const b = makeRanked({ snapshotId: 'b', profitGold: 50, isMispriceCandidate: true });
    const sorted = sortDeals([a, b]);
    expect(sorted[0].snapshotId).toBe('b');
  });

  it('sorts by profit descending within same category', () => {
    const a = makeRanked({ snapshotId: 'a', profitGold: 50, isMispriceCandidate: false });
    const b = makeRanked({ snapshotId: 'b', profitGold: 100, isMispriceCandidate: false });
    const sorted = sortDeals([a, b]);
    expect(sorted[0].snapshotId).toBe('b');
  });
});

function makeRanked(o: { snapshotId: string; profitGold: number; isMispriceCandidate: boolean }) {
  return {
    snapshotId: o.snapshotId,
    itemId: 'x', itemName: 'x', itemType: 'item' as const, itemLevel: null, imagePath: null,
    fairValueSource: null,
    price: 0, pricetype: 0 as const, priceGold: 0, server: 1,
    stallName: '', stallCdkey: '', coords: '', quantity: 1,
    recordedAt: '2026-05-12T00:00:00Z',
    fairValueGold: null, listingMedianGold: null,
    pctBelowFair: null, pctBelowListingMedian: null,
    profitGold: o.profitGold,
    isDeal: true, isScreamingDeal: false,
    isMispriceCandidate: o.isMispriceCandidate,
    confidence: 'modest' as const,
  };
}
