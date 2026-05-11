import { describe, it, expect } from 'vitest';
import { computeMedian, isValuable } from './threshold';
import { VALUABLE_GOLD_THRESHOLD, VALUABLE_CRYSTAL_THRESHOLD } from '@/types/scanner';

describe('computeMedian', () => {
  it('returns 0 for empty array', () => {
    expect(computeMedian([])).toBe(0);
  });
  it('returns the value itself for a single element', () => {
    expect(computeMedian([42])).toBe(42);
  });
  it('returns the middle of an odd-length array', () => {
    expect(computeMedian([1, 5, 3])).toBe(3);
  });
  it('returns the average of the two middle values for even length', () => {
    expect(computeMedian([1, 2, 3, 4])).toBe(2.5);
  });
});

describe('isValuable', () => {
  it('gold median above threshold qualifies (gold currency)', () => {
    expect(isValuable({ pricetype: 0, median: VALUABLE_GOLD_THRESHOLD })).toBe(true);
    expect(isValuable({ pricetype: 0, median: VALUABLE_GOLD_THRESHOLD - 1 })).toBe(false);
  });
  it('crystal median above threshold qualifies (crystal currency)', () => {
    expect(isValuable({ pricetype: 1, median: VALUABLE_CRYSTAL_THRESHOLD })).toBe(true);
    expect(isValuable({ pricetype: 1, median: VALUABLE_CRYSTAL_THRESHOLD - 1 })).toBe(false);
  });
});
