export type FairValueSource =
  | 'gold_only'                 // crystal has no data, use gold median
  | 'crystal_only'              // gold has no data, use crystal median × rate
  | 'gold_dominant'             // both agree (cross-currency ratio within tolerance), gold has more samples
  | 'crystal_dominant'          // both agree, crystal has more samples
  | 'gold_dominant_mismatch'    // disagree → gold has more samples, crystal likely misprice-contaminated
  | 'crystal_dominant_mismatch' // disagree → crystal has more samples, gold likely misprice-contaminated
  | 'insufficient';             // not enough samples in either currency

export interface FairValueInput {
  medianGold: number | null;
  medianCrystal: number | null;
  sampleCountGold: number;
  sampleCountCrystal: number;
  exchangeRate: number; // gold per crystal, e.g., 260
}

export interface FairValueResult {
  value: number | null;            // gold-equivalent fair value
  source: FairValueSource;
}

const MIN_SAMPLES = 1; // any historical sale informs fair value (single rare-pet sales still useful)
const RATIO_TOLERANCE = 2; // gold-from-crystal must be within [0.5x, 2x] of gold-median to "agree"

export function computeFairValue(input: FairValueInput): FairValueResult {
  const { medianGold, medianCrystal, sampleCountGold, sampleCountCrystal, exchangeRate } = input;
  const haveGold = medianGold != null && medianGold > 0 && sampleCountGold >= MIN_SAMPLES;
  const haveCrystal = medianCrystal != null && medianCrystal > 0 && sampleCountCrystal >= MIN_SAMPLES;
  const goldFromCrystal = haveCrystal && exchangeRate > 0
    ? Math.round((medianCrystal as number) * exchangeRate)
    : null;

  // If crystal data exists but we can't convert it (zero exchange rate), treat as unusable
  const haveUsableCrystal = haveCrystal && goldFromCrystal !== null;

  if (!haveGold && !haveUsableCrystal) {
    return { value: null, source: 'insufficient' };
  }
  if (haveGold && !haveUsableCrystal) {
    return { value: medianGold as number, source: 'gold_only' };
  }
  if (!haveGold && haveUsableCrystal) {
    return { value: goldFromCrystal, source: 'crystal_only' };
  }

  // Both currencies have data and are usable — cross-validate
  const g = medianGold as number;
  const c = goldFromCrystal as number;
  const ratio = g / c;
  const crossMatch = ratio >= 1 / RATIO_TOLERANCE && ratio <= RATIO_TOLERANCE;
  const goldDominant = sampleCountGold >= sampleCountCrystal;

  if (crossMatch) {
    return goldDominant
      ? { value: g, source: 'gold_dominant' }
      : { value: c, source: 'crystal_dominant' };
  } else {
    return goldDominant
      ? { value: g, source: 'gold_dominant_mismatch' }
      : { value: c, source: 'crystal_dominant_mismatch' };
  }
}
