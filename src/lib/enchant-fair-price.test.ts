import { describe, it, expect } from 'vitest';
import { fairCrystalPrice, discountPercent, DEFAULT_ANCHOR_CRYSTAL } from './enchant-fair-price';
import { ENCHANT_STONES, parseEnchantStoneName } from '@/data/enchant-stones';

describe('fairCrystalPrice', () => {
  it('doubles per level from the 10-crystal anchor', () => {
    expect(DEFAULT_ANCHOR_CRYSTAL).toBe(10);
    const expected = [10, 20, 40, 80, 160, 320, 640, 1280, 2560, 5120];
    for (let level = 1; level <= 10; level++) {
      expect(fairCrystalPrice(level)).toBe(expected[level - 1]);
    }
  });

  it('respects a custom anchor', () => {
    expect(fairCrystalPrice(1, 15)).toBe(15);
    expect(fairCrystalPrice(4, 15)).toBe(120);
  });

  it('rejects invalid levels and anchors', () => {
    expect(fairCrystalPrice(0)).toBeNull();
    expect(fairCrystalPrice(11)).toBeNull();
    expect(fairCrystalPrice(2.5)).toBeNull();
    expect(fairCrystalPrice(3, 0)).toBeNull();
    expect(fairCrystalPrice(3, -5)).toBeNull();
  });
});

describe('discountPercent', () => {
  it('computes percent below fair', () => {
    expect(discountPercent(50, 100)).toBe(50);
    expect(discountPercent(100, 100)).toBe(0);
    expect(discountPercent(150, 100)).toBe(-50);
    expect(discountPercent(0, 100)).toBe(100);
  });

  it('rejects invalid inputs', () => {
    expect(discountPercent(50, 0)).toBeNull();
    expect(discountPercent(-1, 100)).toBeNull();
  });
});

describe('enchant stone data', () => {
  it('has 7 stats × 10 levels = 70 stones', () => {
    expect(ENCHANT_STONES).toHaveLength(70);
    const stats = new Set(ENCHANT_STONES.map(s => s.stat));
    expect(stats.size).toBe(7);
    for (const stat of stats) {
      const levels = ENCHANT_STONES.filter(s => s.stat === stat).map(s => s.level).sort((a, b) => a - b);
      expect(levels).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    }
  });

  it('has unique stone names', () => {
    const names = ENCHANT_STONES.map(s => s.stoneName);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('parseEnchantStoneName', () => {
  it('parses known stones', () => {
    const sponge = parseEnchantStoneName('附魔石【海綿】');
    expect(sponge).toMatchObject({ level: 1, stat: '防禦', min: 4, max: 7 });

    const ocean = parseEnchantStoneName('附魔石【海洋】');
    expect(ocean).toMatchObject({ level: 10, stat: '魔力', min: 160, max: 220 });

    const marshal = parseEnchantStoneName('附魔石【元帥】');
    expect(marshal).toMatchObject({ level: 10, stat: '攻擊' });
  });

  it('accepts traditional 雲母 as an alias for the guide spelling 云母', () => {
    expect(parseEnchantStoneName('附魔石【雲母】')).toMatchObject({ level: 5, stat: '防禦' });
    expect(parseEnchantStoneName('附魔石【云母】')).toMatchObject({ level: 5, stat: '防禦' });
  });

  it('returns null for unknown stones and non-stone items', () => {
    expect(parseEnchantStoneName('附魔石【謎之石】')).toBeNull();
    expect(parseEnchantStoneName('附魔石')).toBeNull();
    expect(parseEnchantStoneName('聖誕麋鹿')).toBeNull();
    expect(parseEnchantStoneName('魔幣箱（100萬）')).toBeNull();
  });
});
