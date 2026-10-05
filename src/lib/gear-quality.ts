// Gear roll quality: how good is THIS copy of an item, versus how good the item can be.
//
// Two identical listings are not worth the same. Measured on the live market 2026-09-12:
// fourteen 獅子回力鏢 all priced at 800 金幣 carried attack rolls from 70/92 to 94/92, and
// 20 of 426 matchable listings were above their documented cap entirely.
//
// The 頂 / 破頂 vocabulary and the exact `=== max` / `> max` comparison follow
// wodenchen/StarCG's PriceChecker (compareMaxStats), so a listing this app calls 破頂 is the
// same listing that site calls 破頂. Roll percentage, range position and durability are ours.
//
// Every input field here already arrives in each market.php listing — this costs no extra requests.

import {
  EQUIPMENT_MAX_STATS,
  EQUIPMENT_STAT_RANGES,
  EQUIPMENT_STAT_LABELS,
  EQUIPMENT_LEVELS,
} from '@/data/equipment-stats';

/** The subset of a market.php item we need. Extra ITEM_* fields are read dynamically. */
export interface GearListingInput {
  name: string;
  ITEM_ID?: number;
  ITEM_DURABILITY?: number;
  ITEM_MAXDURABILITY?: number;
  [statKey: string]: unknown;
}

export type GearTier = 'break' | 'peak' | 'high' | 'normal' | 'low' | 'unknown';

export interface GearStatRoll {
  key: string;
  label: string;
  actual: number;
  max: number;
  min: number | null;
  /** actual − max. Positive means over-cap (破頂). */
  overBy: number;
  /** actual as a percentage of max. Can exceed 100 for an over-cap roll. */
  pctOfMax: number;
  /** Where the roll landed inside [min, max], 0–100. Null when no range is documented. */
  pctOfRange: number | null;
}

export interface GearQuality {
  /** False when we have no reference row for this item — never guess. */
  known: boolean;
  stats: GearStatRoll[];
  /** Stats sitting exactly on the cap. */
  peak: GearStatRoll[];
  /** Stats above the cap — the rare, disproportionately valuable case. */
  over: GearStatRoll[];
  tier: GearTier;
  /** Total actual across all stats over total max, as a percentage. Null when unknown. */
  rollPct: number | null;
  durability: number | null;
  maxDurability: number | null;
  durabilityPct: number | null;
  isFullDurability: boolean;
  level: number | null;
}

const TIER_LABELS: Record<GearTier, string> = {
  break: '破頂',
  peak: '頂',
  high: '高檔',
  normal: '普通',
  low: '低檔',
  unknown: '未知',
};

export function gearTierLabel(tier: GearTier): string {
  return TIER_LABELS[tier];
}

/** A stat roll at or above this share of max, without hitting the cap, counts as 高檔. */
const HIGH_ROLL_PCT = 90;
/** Below this share of max the copy is materially worse than the item's reputation. */
const LOW_ROLL_PCT = 60;

type MaxProfile = Record<string, number>;
type VariantProfile = { byItemId: Record<string, MaxProfile> };

function isVariant(p: unknown): p is VariantProfile {
  return typeof p === 'object' && p !== null && 'byItemId' in p;
}

/**
 * Resolves the max-stat row for a listing. Some items (英靈之誓) have per-ITEM_ID variants;
 * for those, an unmatched id means we genuinely don't know, so we return null rather than
 * fall back to a sibling variant's numbers.
 */
function resolveProfile(name: string, itemId?: number): MaxProfile | null {
  const entry = EQUIPMENT_MAX_STATS[name];
  if (!entry) return null;
  if (isVariant(entry)) {
    if (itemId == null) return null;
    return entry.byItemId[String(itemId)] ?? null;
  }
  return entry;
}

function statLabel(key: string): string {
  return (EQUIPMENT_STAT_LABELS as Record<string, string>)[key] ?? key;
}

export function assessGear(input: GearListingInput): GearQuality {
  const durability = typeof input.ITEM_DURABILITY === 'number' ? input.ITEM_DURABILITY : null;
  const maxDurability = typeof input.ITEM_MAXDURABILITY === 'number' ? input.ITEM_MAXDURABILITY : null;
  // A max of 0 means the item has no durability concept at all (consumables, scrolls).
  const hasDurability = durability != null && maxDurability != null && maxDurability > 0;
  const durabilityPct = hasDurability ? Math.round((durability / maxDurability) * 100) : null;
  // Compare raw values, not the rounded percentage: 249/250 rounds to 100% but is not full,
  // and a 耐久滿 filter that lets worn items through is worse than no filter.
  const isFullDurability = hasDurability && durability >= maxDurability;

  const base: GearQuality = {
    known: false,
    stats: [],
    peak: [],
    over: [],
    tier: 'unknown',
    rollPct: null,
    durability,
    maxDurability,
    durabilityPct,
    isFullDurability,
    level: EQUIPMENT_LEVELS[input.name] ?? null,
  };

  const profile = resolveProfile(input.name, input.ITEM_ID);
  if (!profile || Object.keys(profile).length === 0) return base;

  const ranges = EQUIPMENT_STAT_RANGES[input.name];
  const stats: GearStatRoll[] = [];
  let totalActual = 0;
  let totalMax = 0;

  for (const [key, max] of Object.entries(profile)) {
    const raw = input[key];
    const actual = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
    const range = ranges?.[key];
    const min = range ? range[0] : null;

    let pctOfRange: number | null = null;
    if (min != null && max > min) {
      // Clamped so an over-cap roll reads 100% here; `overBy` carries the excess.
      pctOfRange = Math.max(0, Math.min(100, Math.round(((actual - min) / (max - min)) * 100)));
    }

    stats.push({
      key,
      label: statLabel(key),
      actual,
      max,
      min,
      overBy: actual - max,
      pctOfMax: max > 0 ? Math.round((actual / max) * 100) : 0,
      pctOfRange,
    });

    totalActual += actual;
    totalMax += max;
  }

  const peak = stats.filter((s) => s.overBy === 0);
  const over = stats.filter((s) => s.overBy > 0);
  const rollPct = totalMax > 0 ? Math.round((totalActual / totalMax) * 100) : null;

  let tier: GearTier;
  if (over.length > 0) tier = 'break';
  else if (peak.length > 0) tier = 'peak';
  else if (rollPct != null && rollPct >= HIGH_ROLL_PCT) tier = 'high';
  else if (rollPct != null && rollPct < LOW_ROLL_PCT) tier = 'low';
  else tier = 'normal';

  return { ...base, known: true, stats, peak, over, tier, rollPct };
}

/**
 * How much the roll should move the price relative to an average copy of the same item.
 * Deliberately conservative: it exists to stop a worn, badly-rolled copy from being ranked as a
 * bargain, not to price 破頂 items (whose real premium is 10x–100x and is set by collectors).
 */
export function gearValueMultiplier(q: GearQuality): number {
  if (!q.known) return 1;
  const roll = q.rollPct ?? 100;
  // Map a 60–100% roll onto a 0.85–1.15 multiplier, flat outside that band.
  const rollFactor = 1 + Math.max(-0.15, Math.min(0.15, ((roll - 80) / 20) * 0.15));
  // Durability scales linearly below half-worn; a 15/250 weapon is nearly worthless.
  const durFactor = q.durabilityPct == null ? 1 : Math.max(0.2, Math.min(1, q.durabilityPct / 50));
  return Number((rollFactor * durFactor).toFixed(3));
}
