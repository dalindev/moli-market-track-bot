import { describe, it, expect } from 'vitest';
import { groupValuableCandidates } from './discovery';
import type { PriceHistoryLogExtended } from '@/types/market';

function makeLog(o: Partial<PriceHistoryLogExtended>): PriceHistoryLogExtended {
  return {
    id: 0, cdkey: '', buycdkey: '', buyname: '', buff: '',
    price: 0, pricetype: 0, time: 0, time_text: '', check: 0,
    ts: 0, qty: 1, item_name: '', gross_price: 0,
    unit_price: 0, unit_gross_price: 0, currency_label: '金幣',
    ...o,
  };
}

describe('groupValuableCandidates', () => {
  it('returns empty array for empty input', () => {
    expect(groupValuableCandidates([])).toEqual([]);
  });

  it('groups by (item_name, pricetype) and includes items with median >= gold threshold', () => {
    const logs = [
      makeLog({ item_name: '偷襲密卷', pricetype: 0, unit_price: 40_000 }),
      makeLog({ item_name: '偷襲密卷', pricetype: 0, unit_price: 45_000 }),
      makeLog({ item_name: '偷襲密卷', pricetype: 0, unit_price: 50_000 }),
    ];
    const result = groupValuableCandidates(logs);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('偷襲密卷');
    expect(result[0].pricetype).toBe(0);
    expect(result[0].median).toBe(45_000);
  });

  it('includes items with median >= crystal threshold (250)', () => {
    const logs = [
      makeLog({ item_name: 'rare-thing', pricetype: 1, unit_price: 300 }),
      makeLog({ item_name: 'rare-thing', pricetype: 1, unit_price: 250 }),
    ];
    const result = groupValuableCandidates(logs);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('rare-thing');
    expect(result[0].pricetype).toBe(1);
  });

  it('excludes items below threshold in both currencies', () => {
    const logs = [
      makeLog({ item_name: 'cheap', pricetype: 0, unit_price: 100 }),
      makeLog({ item_name: 'cheap', pricetype: 0, unit_price: 200 }),
      makeLog({ item_name: 'cheap', pricetype: 1, unit_price: 5 }),
    ];
    expect(groupValuableCandidates(logs)).toHaveLength(0);
  });

  it('handles same item with both currencies as separate groups', () => {
    const logs = [
      makeLog({ item_name: 'dual', pricetype: 0, unit_price: 50_000 }),
      makeLog({ item_name: 'dual', pricetype: 0, unit_price: 60_000 }),
      makeLog({ item_name: 'dual', pricetype: 1, unit_price: 300 }),
      makeLog({ item_name: 'dual', pricetype: 1, unit_price: 350 }),
    ];
    const result = groupValuableCandidates(logs);
    expect(result).toHaveLength(2);
    expect(result.find((c) => c.pricetype === 0)?.median).toBe(55_000);
    expect(result.find((c) => c.pricetype === 1)?.median).toBe(325);
  });

  it('ignores zero unit_price entries (malformed logs)', () => {
    const logs = [
      makeLog({ item_name: 'x', pricetype: 0, unit_price: 50_000 }),
      makeLog({ item_name: 'x', pricetype: 0, unit_price: 0 }),
      makeLog({ item_name: 'x', pricetype: 0, unit_price: 50_000 }),
    ];
    const result = groupValuableCandidates(logs);
    expect(result[0].sampleSize).toBe(2);
  });
});
