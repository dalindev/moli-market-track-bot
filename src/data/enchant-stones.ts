// 附魔石 (enchant stone) reference data
// Source: https://guide.starcg.net/production/gems#附魔石加乘一覽
// 7 stats × 10 levels. Level N is made by merging two level N−1 stones.

export type EnchantStat = '防禦' | '敏捷' | '生命' | '魔力' | '攻擊' | '回復' | '精神';

export interface EnchantStone {
  /** Name inside 【】, e.g. 海綿 */
  stoneName: string;
  /** Full item name, e.g. 附魔石【海綿】 */
  fullName: string;
  level: number; // 1-10
  stat: EnchantStat;
  /** Equipment slot restriction (限制) */
  slot: string;
  min: number;
  max: number;
}

// Stats whose stones trade well above the merge-cost baseline (rare / in demand)
export const HIGH_VALUE_STATS: ReadonlySet<EnchantStat> = new Set(['生命', '攻擊']);

export const ENCHANT_STAT_SLOTS: Record<EnchantStat, string> = {
  防禦: '全身',
  敏捷: '足部',
  生命: '全身',
  魔力: '頭部',
  攻擊: '武器',
  回復: '防具',
  精神: '武器',
};

// [stoneName, min, max] indexed by level-1
const STONE_TABLE: Record<EnchantStat, Array<[string, number, number]>> = {
  防禦: [
    ['海綿', 4, 7], ['石蠟', 6, 9], ['石膏', 8, 11], ['滑石', 10, 14], ['云母', 14, 18],
    ['螢石', 17, 22], ['輝石', 22, 30], ['石英', 28, 38], ['剛玉', 36, 52], ['金剛玉', 48, 66],
  ],
  敏捷: [
    ['微風', 2, 5], ['暖風', 3, 6], ['清風', 4, 7], ['強風', 5, 9], ['疾風', 6, 12],
    ['烈風', 8, 15], ['狂風', 11, 19], ['暴風', 16, 24], ['颶風', 20, 32], ['罡風', 27, 40],
  ],
  生命: [
    ['落葉', 6, 15], ['小草', 9, 18], ['歌聲', 12, 22], ['月影', 16, 26], ['春風', 22, 32],
    ['風雲', 30, 40], ['金星', 38, 52], ['慈雨', 50, 68], ['太陽', 66, 88], ['寂靜', 80, 120],
  ],
  魔力: [
    ['霧氣', 14, 25], ['露水', 19, 32], ['水窪', 25, 40], ['池塘', 30, 50], ['山澗', 40, 62],
    ['小溪', 54, 78], ['湖泊', 72, 98], ['河流', 96, 128], ['港灣', 124, 166], ['海洋', 160, 220],
  ],
  攻擊: [
    ['預備兵', 2, 4], ['斥候', 3, 5], ['列兵', 4, 6], ['老兵', 5, 8], ['騎士', 6, 11],
    ['百夫長', 8, 13], ['萬夫長', 11, 17], ['將軍', 14, 22], ['司令', 19, 28], ['元帥', 25, 36],
  ],
  回復: [
    ['火花', 1, 2], ['螢火', 1, 3], ['燭火', 2, 3], ['篝火', 2, 4], ['灶火', 3, 5],
    ['烽火', 4, 6], ['戰火', 5, 8], ['業火', 7, 10], ['聖火', 9, 13], ['神火', 11, 18],
  ],
  精神: [
    ['農夫', 1, 3], ['學徒', 2, 3], ['學者', 3, 4], ['教師', 3, 5], ['教授', 4, 7],
    ['魔法師', 5, 9], ['魔導師', 7, 11], ['法皇', 10, 14], ['賢者', 13, 18], ['聖賢', 16, 25],
  ],
};

export const ENCHANT_STONES: EnchantStone[] = (
  Object.entries(STONE_TABLE) as Array<[EnchantStat, Array<[string, number, number]>]>
).flatMap(([stat, rows]) =>
  rows.map(([stoneName, min, max], i) => ({
    stoneName,
    fullName: `附魔石【${stoneName}】`,
    level: i + 1,
    stat,
    slot: ENCHANT_STAT_SLOTS[stat],
    min,
    max,
  }))
);

const byStoneName = new Map(ENCHANT_STONES.map(s => [s.stoneName, s]));
// The guide spells lv5 防禦 with simplified 云; in-game may use traditional 雲
byStoneName.set('雲母', byStoneName.get('云母')!);

/**
 * Parse a market listing name into its enchant stone.
 * Returns null for non-附魔石 items and unknown stone names.
 */
export function parseEnchantStoneName(name: string): EnchantStone | null {
  if (!name.includes('附魔石')) return null;
  const m = name.match(/【(.+?)】/);
  if (!m) return null;
  return byStoneName.get(m[1]) ?? null;
}
