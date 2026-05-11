import { VALUABLE_GOLD_THRESHOLD, VALUABLE_CRYSTAL_THRESHOLD } from '@/types/scanner';

export function computeMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export interface ValuableInput {
  pricetype: number; // 0 = gold, 1 = crystal
  median: number;
}

export function isValuable(input: ValuableInput): boolean {
  if (input.pricetype === 0) return input.median >= VALUABLE_GOLD_THRESHOLD;
  if (input.pricetype === 1) return input.median >= VALUABLE_CRYSTAL_THRESHOLD;
  return false;
}
