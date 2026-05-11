import { computeMedian } from './threshold';
import type { PriceHistoryLogExtended } from '@/types/market';

export interface ExchangeRateResult {
  gold_per_crystal: number;
  source_item_name: string;
  sample_size: number;
  median_crystal_price: number;
}

interface BoxSpec {
  name: string;
  goldValue: number;
}

const BOX_SPECS: BoxSpec[] = [
  { name: '魔幣箱（100萬）', goldValue: 1_000_000 },
  { name: '魔幣箱（10萬）', goldValue: 100_000 },
];

export function deriveExchangeRate(logs: PriceHistoryLogExtended[]): ExchangeRateResult | null {
  for (const spec of BOX_SPECS) {
    const crystalPrices = logs
      .filter((l) => l.item_name === spec.name && l.pricetype === 1 && l.unit_price > 0)
      .map((l) => l.unit_price);

    if (crystalPrices.length === 0) continue;

    const median = computeMedian(crystalPrices);
    if (median <= 0) continue;

    return {
      gold_per_crystal: spec.goldValue / median,
      source_item_name: spec.name,
      sample_size: crystalPrices.length,
      median_crystal_price: Math.round(median),
    };
  }

  return null;
}
