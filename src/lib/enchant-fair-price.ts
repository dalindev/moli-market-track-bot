// Fair price model for 附魔石: level N is merged from two level N−1 stones,
// so fair price doubles per level from the lv1 anchor.

export const DEFAULT_ANCHOR_CRYSTAL = 10; // lv1 fair price in 魔晶
export const MIN_STONE_LEVEL = 1;
export const MAX_STONE_LEVEL = 10;

/** Fair price in crystal for a stone of the given level. Null for invalid input. */
export function fairCrystalPrice(
  level: number,
  anchorCrystal: number = DEFAULT_ANCHOR_CRYSTAL
): number | null {
  if (!Number.isInteger(level) || level < MIN_STONE_LEVEL || level > MAX_STONE_LEVEL) return null;
  if (!(anchorCrystal > 0)) return null;
  return anchorCrystal * 2 ** (level - 1);
}

/**
 * Percent below fair value (positive = cheaper than fair, negative = overpriced).
 * e.g. listing at 50 gold vs fair 100 gold → 50.
 */
export function discountPercent(listingGold: number, fairGold: number): number | null {
  if (!(fairGold > 0) || !(listingGold >= 0)) return null;
  return ((fairGold - listingGold) / fairGold) * 100;
}
