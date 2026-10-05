import { describe, it, expect } from 'vitest';
import { assessGear, gearTierLabel, type GearListingInput } from './gear-quality';
import { EQUIPMENT_MAX_STATS, EQUIPMENT_STAT_RANGES } from '@/data/equipment-stats';

function listing(over: Partial<GearListingInput> = {}): GearListingInput {
  return { name: '獅子回力鏢', ...over };
}

describe('equipment reference data', () => {
  it('has the max-stat rows the sync script reported', () => {
    expect(Object.keys(EQUIPMENT_MAX_STATS).length).toBeGreaterThan(400);
    expect(EQUIPMENT_MAX_STATS['長劍']).toEqual({ ITEM_MODIFYATTACK: 24 });
  });

  it('carries per-stat [min, max] ranges from the guide catalogue', () => {
    // 長劍 is documented as 攻擊 +12 ~ +24 on guide.starcg.net/equipment/sword
    expect(EQUIPMENT_STAT_RANGES['長劍']?.ITEM_MODIFYATTACK).toEqual([12, 24]);
  });
});

describe('assessGear', () => {
  it('returns unknown for an item with no reference row', () => {
    const g = assessGear(listing({ name: '不存在的東西', ITEM_MODIFYATTACK: 999 }));
    expect(g.known).toBe(false);
    expect(g.tier).toBe('unknown');
    expect(g.stats).toEqual([]);
  });

  it('flags a stat exactly at max as 頂 (peak)', () => {
    const g = assessGear(listing({ name: '長劍', ITEM_MODIFYATTACK: 24 }));
    expect(g.peak.map((s) => s.key)).toEqual(['ITEM_MODIFYATTACK']);
    expect(g.over).toEqual([]);
    expect(g.tier).toBe('peak');
  });

  it('flags a stat above max as 破頂 (over-cap) — the 10x-100x item', () => {
    // Measured live 2026-09-12: 新月斧 攻擊 238 against a documented max of 232.
    const g = assessGear(listing({ name: '新月斧', ITEM_MODIFYATTACK: 238 }));
    expect(g.over).toHaveLength(1);
    expect(g.over[0].overBy).toBe(6);
    expect(g.over[0].actual).toBe(238);
    expect(g.tier).toBe('break');
  });

  it('reports break even when another stat is merely mid-roll', () => {
    const g = assessGear(listing({ name: '新月斧', ITEM_MODIFYATTACK: 233 }));
    expect(g.tier).toBe('break');
    expect(g.over[0].overBy).toBe(1);
  });

  it('treats a missing stat field as zero rather than throwing', () => {
    const g = assessGear(listing({ name: '長劍' }));
    expect(g.known).toBe(true);
    expect(g.stats[0].actual).toBe(0);
    expect(g.tier).toBe('low');
  });

  it('scores position within the documented [min, max] range', () => {
    // 長劍 rolls 12..24, so 18 sits exactly halfway.
    const g = assessGear(listing({ name: '長劍', ITEM_MODIFYATTACK: 18 }));
    expect(g.stats[0].pctOfRange).toBe(50);
    expect(g.stats[0].pctOfMax).toBe(75);
  });

  it('clamps range percentage at 100 for an over-cap roll but keeps overBy', () => {
    const g = assessGear(listing({ name: '長劍', ITEM_MODIFYATTACK: 26 }));
    expect(g.stats[0].pctOfRange).toBe(100);
    expect(g.stats[0].overBy).toBe(2);
    expect(g.tier).toBe('break');
  });

  it('aggregates multi-stat gear by total roll across every stat', () => {
    const profile = EQUIPMENT_MAX_STATS['屈原的戒指'] as Record<string, number>;
    const half: GearListingInput = { name: '屈原的戒指' };
    for (const [k, v] of Object.entries(profile)) {
      (half as Record<string, unknown>)[k] = Math.round(v / 2);
    }
    const g = assessGear(half);
    expect(g.rollPct).toBeGreaterThan(45);
    expect(g.rollPct).toBeLessThan(55);
  });

  it('resolves per-itemId variants (英靈之誓 has three coloured versions)', () => {
    const variant = EQUIPMENT_MAX_STATS['英靈之誓'] as { byItemId: Record<string, Record<string, number>> };
    const id = Object.keys(variant.byItemId).find((k) => Object.keys(variant.byItemId[k]).length > 0)!;
    const stats = variant.byItemId[id];
    const firstKey = Object.keys(stats)[0];
    const g = assessGear({ name: '英靈之誓', ITEM_ID: Number(id), [firstKey]: stats[firstKey] });
    expect(g.known).toBe(true);
    expect(g.peak.some((s) => s.key === firstKey)).toBe(true);
  });

  it('is unknown for a variant item when the itemId does not match a variant', () => {
    const g = assessGear({ name: '英靈之誓', ITEM_ID: 999999, ITEM_MODIFYHP: 20 });
    expect(g.known).toBe(false);
  });

  describe('durability', () => {
    it('computes remaining durability as a percentage', () => {
      const g = assessGear(listing({ ITEM_DURABILITY: 15, ITEM_MAXDURABILITY: 250 }));
      expect(g.durabilityPct).toBe(6);
    });

    it('reports null when the item has no durability concept', () => {
      const g = assessGear(listing({ ITEM_DURABILITY: 0, ITEM_MAXDURABILITY: 0 }));
      expect(g.durabilityPct).toBeNull();
    });

    it('treats a full-durability item as 100%', () => {
      const g = assessGear(listing({ ITEM_DURABILITY: 250, ITEM_MAXDURABILITY: 250 }));
      expect(g.durabilityPct).toBe(100);
      expect(g.isFullDurability).toBe(true);
    });

    it('does not call a partially worn item full durability', () => {
      const g = assessGear(listing({ ITEM_DURABILITY: 249, ITEM_MAXDURABILITY: 250 }));
      expect(g.isFullDurability).toBe(false);
    });
  });
});

describe('gearTierLabel', () => {
  it('uses the game community terms for peak and over-cap', () => {
    expect(gearTierLabel('break')).toBe('破頂');
    expect(gearTierLabel('peak')).toBe('頂');
  });
});
