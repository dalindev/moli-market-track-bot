// Pure calculation functions for pet stat & score simulation
import {
  SCORE_WEIGHTS,
  SKILL_SLOT_WEIGHT,
  BP_TO_STAT_MATRIX,
  STAT_BASE,
} from "@/data/pet-types";

export interface CalcInput {
  level: number;
  rate: number; // 倍率, default 0.2
  base: number[]; // [vit, str, def, agi, mag] - 原始檔次
  lost: number[]; // [0~-4 each] - 掉檔
  rand: number[]; // [0~10 each, sum<=10] - 隨機檔
  manual: number[]; // 配點
  cardRank: number; // 0=無, 6=普, 7=銀, 8=金 (BP per mod)
  modGrade: number; // 0~5 改造次數
  skillSlots: number; // 6~10
}

export interface FinalStats {
  hp: number;
  mp: number;
  atk: number;
  def: number;
  agi: number;
  spt: number;
  rec: number;
}

export interface ScoreBreakdown {
  baseScore: number;
  skillScore: number;
  fullBonus: number;
  total: number;
  contributions: Record<string, number>;
}

/**
 * Calculate 5 BP values from input parameters
 */
export function calculateBP(input: CalcInput): number[] {
  const { level, rate, base, lost, rand, manual } = input;

  // Calculate base BP for each stat
  const realRanks = base.map((b, i) => b - Math.abs(lost[i]));
  const bpBase = realRanks.map((realRank, i) => {
    const bpLv1 = realRank * rate + rand[i] * rate;
    const bpGrowth = realRank / 24.0;
    return bpLv1 + bpGrowth * (level - 1);
  });

  // Final BP (no per-stat cap — allow all manual points freely)
  const bp = realRanks.map((realRank, i) => {
    const bpLv1 = realRank * rate + rand[i] * rate;
    const bpGrowth = realRank / 24.0;
    return bpLv1 + bpGrowth * (level - 1) + manual[i];
  });

  return bp;
}

/**
 * Calculate point allocation info
 */
export function calculatePointInfo(input: CalcInput) {
  const { level, rate, base, lost, rand, manual, cardRank, modGrade } = input;
  const lvlLimit = Math.max(0, level - 1);
  const modLimit = cardRank * modGrade;
  const totalLimit = lvlLimit + modLimit;

  const realRanks = base.map((b, i) => b - Math.abs(lost[i]));
  const bpBase = realRanks.map((realRank, i) => {
    const bpLv1 = realRank * rate + rand[i] * rate;
    const bpGrowth = realRank / 24.0;
    return bpLv1 + bpGrowth * (level - 1);
  });

  const currentUsed = manual.reduce((a, b) => a + b, 0);

  return {
    totalLimit,
    currentUsed,
    remaining: totalLimit - currentUsed,
    manualCapped: manual,
    perStatMaxBP: manual.map(() => Infinity),
    overLimit: currentUsed > totalLimit,
  };
}

/**
 * Convert 5 BP values to 7 final stats (floored)
 */
export function bpToStats(bp: number[]): FinalStats {
  const raw = bpToStatsRaw(bp);
  return {
    hp: Math.floor(raw.hp),
    mp: Math.floor(raw.mp),
    atk: Math.floor(raw.atk),
    def: Math.floor(raw.def),
    agi: Math.floor(raw.agi),
    spt: Math.floor(raw.spt),
    rec: Math.floor(raw.rec),
  };
}

export interface RawStats {
  hp: number;
  mp: number;
  atk: number;
  def: number;
  agi: number;
  spt: number;
  rec: number;
}

/**
 * Convert 5 BP values to 7 raw stats (not floored, full precision)
 */
export function bpToStatsRaw(bp: number[]): RawStats {
  const matrix = BP_TO_STAT_MATRIX;
  const base = STAT_BASE;

  const calc = (key: keyof typeof matrix) => {
    const coeffs = matrix[key];
    const baseVal = base[key];
    let sum = baseVal;
    for (let i = 0; i < 5; i++) {
      sum += bp[i] * coeffs[i];
    }
    return sum;
  };

  return {
    hp: calc("hp"),
    mp: calc("mp"),
    atk: calc("atk"),
    def: calc("def"),
    agi: calc("agi"),
    spt: calc("spt"),
    rec: calc("rec"),
  };
}

/**
 * Calculate full stats from input
 */
export function calculateStats(input: CalcInput): FinalStats {
  const bp = calculateBP(input);
  return bpToStats(bp);
}

/**
 * Calculate full raw stats from input (not floored)
 */
export function calculateStatsRaw(input: CalcInput): RawStats {
  const bp = calculateBP(input);
  return bpToStatsRaw(bp);
}

/**
 * Calculate score from final stats
 */
export function calculateScore(
  stats: FinalStats,
  skillSlots: number,
  level: number,
  cardFullBonus: number
): ScoreBreakdown {
  const w = SCORE_WEIGHTS;

  const contributions = {
    hp: (stats.hp * w.hp) / 3,
    mp: (stats.mp * w.mp) / 3,
    atk: (stats.atk * w.atk) / 3,
    def: (stats.def * w.def) / 3,
    agi: (stats.agi * w.agi) / 3,
    spr: (stats.spt * w.spr) / 3,
    rec: (stats.rec * w.rec) / 3,
  };

  const baseScore = Object.values(contributions).reduce((a, b) => a + b, 0);
  const sPoint = SKILL_SLOT_WEIGHT[skillSlots] || 0;
  const skillScore = Math.floor((sPoint / 100) * level);
  const total = Math.floor(baseScore + skillScore + cardFullBonus);

  return { baseScore, skillScore, fullBonus: cardFullBonus, total, contributions };
}

/**
 * Reverse calculation: given observed final stats (HP, MP, ATK, DEF, AGI),
 * solve for the 5 BP values using the conversion matrix.
 *
 * Uses the first 5 stats (HP, MP, ATK, DEF, AGI) which map to 5 equations
 * for 5 unknowns (bp[0..4]).
 */
export function reverseStatsToRandom(
  observedStats: { hp: number; mp: number; atk: number; def: number; agi: number },
  level: number,
  rate: number,
  base: number[],
  lost: number[],
  manual: number[]
): number[] {
  // Step 1: Solve for BP from observed stats
  // We use the 5x5 matrix from HP, MP, ATK, DEF, AGI
  const matrix = [
    [8.0, 2.0, 3.0, 3.0, 1.0],   // HP
    [1.0, 2.0, 2.0, 2.0, 10.0],  // MP
    [0.2, 2.7, 0.3, 0.3, 0.2],   // ATK
    [0.2, 0.3, 3.0, 0.3, 0.2],   // DEF
    [0.1, 0.2, 0.2, 2.0, 0.1],   // AGI
  ];

  // Since stats are floor()'d, add 0.5 to get better midpoint estimate
  const rhs = [
    observedStats.hp - 20 + 0.5,
    observedStats.mp - 20 + 0.5,
    observedStats.atk - 20 + 0.5,
    observedStats.def - 20 + 0.5,
    observedStats.agi - 20 + 0.5,
  ];

  // Gaussian elimination
  const n = 5;
  const aug: number[][] = matrix.map((row, i) => [...row, rhs[i]]);

  for (let col = 0; col < n; col++) {
    // Partial pivot
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) maxRow = row;
    }
    [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];

    const pivot = aug[col][col];
    if (Math.abs(pivot) < 1e-10) continue;

    for (let j = col; j <= n; j++) aug[col][j] /= pivot;

    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = aug[row][col];
      for (let j = col; j <= n; j++) aug[row][j] -= factor * aug[col][j];
    }
  }

  const bp = aug.map((row) => row[n]);

  // Step 2: Derive random rank from BP
  const realRanks = base.map((b, i) => b - Math.abs(lost[i]));
  const randomRanks = realRanks.map((realRank, i) => {
    // bp[i] = (realRank * rate) + (rand[i] * rate) + (realRank / 24) * (level - 1) + manual[i]
    // rand[i] = (bp[i] - manual[i] - realRank * rate - (realRank / 24) * (level - 1)) / rate
    const bpWithoutRand =
      realRank * rate + (realRank / 24.0) * (level - 1) + (manual[i] || 0);
    const randBP = bp[i] - bpWithoutRand;
    return rate > 0 ? randBP / rate : 0;
  });

  // Round to nearest integer (no clamping — caller handles bounds)
  return randomRanks.map((r) => Math.round(r));
}
