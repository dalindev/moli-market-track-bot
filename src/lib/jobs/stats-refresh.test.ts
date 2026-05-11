import { describe, it, expect } from 'vitest';
import { pickPerCurrencyStats } from './stats-refresh';
import type { MarketRecordResponseV2, PriceHistoryLogExtended } from '@/types/market';

function makeResponse(overrides: Partial<MarketRecordResponseV2>): MarketRecordResponseV2 {
  return {
    page: 1, perPage: 50, totalFiltered: 0, totalFilteredRaw: 0,
    resultsTruncated: false, range: '30d', sort: 'time_desc',
    currency: 'all', type: 'all',
    logs: [],
    stats: {
      count: 0, min: 0, max: 0, avg: 0, median: 0, trend: [],
      is_unit_price: true, pricetype_mixed: false, pricetype_single: null,
    },
    trend6m: { days: [], pricetype_single: null, start_day: '', end_day: '', chart_mode: 'daily_median_iqr' },
    ...overrides,
  };
}

function makeLog(o: Partial<PriceHistoryLogExtended>): PriceHistoryLogExtended {
  return {
    id: 0, cdkey: '', buycdkey: '', buyname: '', buff: '',
    price: 0, pricetype: 0, time: 0, time_text: '', check: 0,
    ts: 0, qty: 1, item_name: '', gross_price: 0,
    unit_price: 0, unit_gross_price: 0, currency_label: '',
    ...o,
  };
}

describe('pickPerCurrencyStats', () => {
  it('returns the server median into gold when pricetype_single=0', () => {
    const res = makeResponse({
      stats: { count: 10, min: 30_000, max: 60_000, avg: 45_000, median: 45_000, trend: [],
        is_unit_price: true, pricetype_mixed: false, pricetype_single: 0 },
    });
    const result = pickPerCurrencyStats(res);
    expect(result.gold).toEqual({ median: 45_000, min: 30_000, max: 60_000, count: 10 });
    expect(result.crystal).toBeNull();
  });

  it('returns the server median into crystal when pricetype_single=1', () => {
    const res = makeResponse({
      stats: { count: 5, min: 300, max: 400, avg: 350, median: 350, trend: [],
        is_unit_price: true, pricetype_mixed: false, pricetype_single: 1 },
    });
    const result = pickPerCurrencyStats(res);
    expect(result.crystal).toEqual({ median: 350, min: 300, max: 400, count: 5 });
    expect(result.gold).toBeNull();
  });

  it('falls back to client-side per-currency medians when pricetype_mixed=true', () => {
    const res = makeResponse({
      stats: { count: 4, min: 0, max: 0, avg: 0, median: 0, trend: [],
        is_unit_price: true, pricetype_mixed: true, pricetype_single: null },
      logs: [
        makeLog({ pricetype: 0, unit_price: 40_000 }),
        makeLog({ pricetype: 0, unit_price: 50_000 }),
        makeLog({ pricetype: 1, unit_price: 200 }),
        makeLog({ pricetype: 1, unit_price: 300 }),
      ],
    });
    const result = pickPerCurrencyStats(res);
    expect(result.gold).toEqual({ median: 45_000, min: 40_000, max: 50_000, count: 2 });
    expect(result.crystal).toEqual({ median: 250, min: 200, max: 300, count: 2 });
  });

  it('returns nulls when no usable stats', () => {
    const res = makeResponse({});
    const result = pickPerCurrencyStats(res);
    expect(result.gold).toBeNull();
    expect(result.crystal).toBeNull();
  });
});
