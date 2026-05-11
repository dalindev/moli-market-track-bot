import { describe, it, expect } from 'vitest';
import { computeFairValue } from './fair-value';

const RATE = 260;

describe('computeFairValue', () => {
  it('returns insufficient when neither currency has any samples', () => {
    const r = computeFairValue({ medianGold: null, medianCrystal: null, sampleCountGold: 0, sampleCountCrystal: 0, exchangeRate: RATE });
    expect(r.source).toBe('insufficient');
    expect(r.value).toBeNull();
  });

  it('accepts single-sample data (rare pets often have only 1 historical sale)', () => {
    // 猶大 case: 1 crystal sale at 263200
    const r = computeFairValue({ medianGold: null, medianCrystal: 263200, sampleCountGold: 0, sampleCountCrystal: 1, exchangeRate: RATE });
    expect(r.source).toBe('crystal_only');
    expect(r.value).toBe(68_432_000); // 263200 * 260
  });

  it('uses gold when only gold has data', () => {
    const r = computeFairValue({ medianGold: 50000, medianCrystal: null, sampleCountGold: 10, sampleCountCrystal: 0, exchangeRate: RATE });
    expect(r.source).toBe('gold_only');
    expect(r.value).toBe(50000);
  });

  it('uses crystal × rate when only crystal has data', () => {
    const r = computeFairValue({ medianGold: null, medianCrystal: 500, sampleCountGold: 0, sampleCountCrystal: 10, exchangeRate: RATE });
    expect(r.source).toBe('crystal_only');
    expect(r.value).toBe(130_000);
  });

  it('flags gold_dominant when both agree and gold has more samples', () => {
    const r = computeFairValue({ medianGold: 50000, medianCrystal: 200, sampleCountGold: 20, sampleCountCrystal: 5, exchangeRate: RATE });
    // crystal × rate = 52000 → ratio 50000/52000 = 0.96 (within tolerance)
    expect(r.source).toBe('gold_dominant');
    expect(r.value).toBe(50000);
  });

  it('flags crystal_dominant when both agree and crystal has more samples', () => {
    const r = computeFairValue({ medianGold: 50000, medianCrystal: 200, sampleCountGold: 5, sampleCountCrystal: 20, exchangeRate: RATE });
    expect(r.source).toBe('crystal_dominant');
    expect(r.value).toBe(52000); // crystal × rate
  });

  it('flags crystal_dominant_mismatch when gold is way below crystal × rate (misprice cluster)', () => {
    // Real 寵物再生藥劑 case: 7 gold sales at 9, 26 crystal sales at 564
    const r = computeFairValue({ medianGold: 9, medianCrystal: 564, sampleCountGold: 7, sampleCountCrystal: 26, exchangeRate: RATE });
    expect(r.source).toBe('crystal_dominant_mismatch');
    expect(r.value).toBe(146_640); // 564 × 260
  });

  it('flags gold_dominant_mismatch when crystal is way above gold × rate', () => {
    // Symmetric case: crystal mispriced high (rare but possible)
    const r = computeFairValue({ medianGold: 50000, medianCrystal: 1000, sampleCountGold: 20, sampleCountCrystal: 3, exchangeRate: RATE });
    // crystal × rate = 260_000 → ratio 50000/260000 = 0.19 → mismatch
    expect(r.source).toBe('gold_dominant_mismatch');
    expect(r.value).toBe(50000);
  });

  it('returns insufficient when exchangeRate is 0 and only crystal data', () => {
    const r = computeFairValue({ medianGold: null, medianCrystal: 500, sampleCountGold: 0, sampleCountCrystal: 10, exchangeRate: 0 });
    expect(r.source).toBe('insufficient');
  });
});
