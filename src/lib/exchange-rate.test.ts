import { describe, it, expect } from 'vitest';
import { deriveExchangeRate } from './exchange-rate';
import type { PriceHistoryLogExtended } from '@/types/market';

function makeLog(overrides: Partial<PriceHistoryLogExtended>): PriceHistoryLogExtended {
  return {
    id: 0,
    cdkey: '',
    buycdkey: '',
    buyname: '',
    buff: '',
    price: 0,
    pricetype: 1,
    time: 0,
    time_text: '',
    check: 0,
    ts: 0,
    qty: 1,
    item_name: '',
    gross_price: 0,
    unit_price: 0,
    unit_gross_price: 0,
    currency_label: '魔晶',
    ...overrides,
  };
}

describe('deriveExchangeRate', () => {
  it('returns null when no 100w box sales found', () => {
    const logs: PriceHistoryLogExtended[] = [
      makeLog({ item_name: '某道具', pricetype: 0, unit_price: 1000 }),
    ];
    expect(deriveExchangeRate(logs)).toBeNull();
  });

  it('derives rate from 100w box crystal sales (gold_per_crystal = 1_000_000 / median)', () => {
    const logs: PriceHistoryLogExtended[] = [
      makeLog({ item_name: '魔幣箱（100萬）', pricetype: 1, unit_price: 3800 }),
      makeLog({ item_name: '魔幣箱（100萬）', pricetype: 1, unit_price: 3854 }),
      makeLog({ item_name: '魔幣箱（100萬）', pricetype: 1, unit_price: 3900 }),
    ];
    const result = deriveExchangeRate(logs);
    expect(result).not.toBeNull();
    expect(result!.gold_per_crystal).toBeCloseTo(1_000_000 / 3854, 1);
    expect(result!.source_item_name).toBe('魔幣箱（100萬）');
    expect(result!.sample_size).toBe(3);
    expect(result!.median_crystal_price).toBe(3854);
  });

  it('ignores gold sales of 100w box (only crystal trades inform the rate)', () => {
    const logs: PriceHistoryLogExtended[] = [
      makeLog({ item_name: '魔幣箱（100萬）', pricetype: 0, unit_price: 999_999 }), // ignored
      makeLog({ item_name: '魔幣箱（100萬）', pricetype: 1, unit_price: 3800 }),
    ];
    const result = deriveExchangeRate(logs);
    expect(result).not.toBeNull();
    expect(result!.sample_size).toBe(1);
  });

  it('falls back to 10w box if 100w box is unavailable', () => {
    const logs: PriceHistoryLogExtended[] = [
      makeLog({ item_name: '魔幣箱（10萬）', pricetype: 1, unit_price: 380 }),
      makeLog({ item_name: '魔幣箱（10萬）', pricetype: 1, unit_price: 385 }),
    ];
    const result = deriveExchangeRate(logs);
    expect(result).not.toBeNull();
    expect(result!.source_item_name).toBe('魔幣箱（10萬）');
    // 10w box: gold_per_crystal = 100_000 / median
    expect(result!.gold_per_crystal).toBeCloseTo(100_000 / 382.5, 1);
  });
});
