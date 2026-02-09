// Pet data types and constants for StarCG (星詠魔力)
// Source: cg-hoshino.online pets.json + new_pets_data.json
// Last updated: 2026-02-08

export interface PetData {
  name: string;
  race: string;
  elements: { earth: number; water: number; fire: number; wind: number };
  cardType: "金" | "銀" | "普";
  hp: number;      // 體力 (Vit)
  power: number;   // 力量 (Str)
  defense: number; // 強度 (Def)
  speed: number;   // 速度 (Agi)
  magic: number;   // 魔法 (Mag)
  total: number;
  skillSlots: number;
  washPrice: number;
}

export const RACES = [
  "不死系", "人形系", "昆蟲系", "植物系", "特殊系",
  "野獸系", "金屬系", "飛行系", "龍系",
] as const;

export type Race = (typeof RACES)[number];

// Card type → max star total
export const CARD_TYPE_MAX_TOTAL: Record<string, number> = {
  "金": 129,
  "銀": 127,
  "普": 125,
};

// Card type → BP per modification grade
export const CARD_RANK_BP: Record<string, number> = {
  "金": 8,
  "銀": 7,
  "普": 6,
};

// Card type → full rank score bonus
export const CARD_FULL_BONUS: Record<string, number> = {
  "金": 100,
  "銀": 80,
  "普": 60,
};

// Skill slot → weight for score calculation
export const SKILL_SLOT_WEIGHT: Record<number, number> = {
  6: 10, 7: 30, 8: 60, 9: 100, 10: 150,
};

// Score calculation weights (stat → multiplier)
export const SCORE_WEIGHTS = {
  hp: 0.985,
  mp: 0.522,
  atk: 3.21,
  def: 1.71,
  agi: 2.90,
  spr: 7,
  rec: 5,
} as const;

// BP → final stat conversion matrix
// Rows: [Vit, Str, Def, Agi, Mag] → columns: stat
export const BP_TO_STAT_MATRIX = {
  hp:  [8.0,  2.0,  3.0,  3.0,  1.0],   // base 20
  mp:  [1.0,  2.0,  2.0,  2.0,  10.0],  // base 20
  atk: [0.2,  2.7,  0.3,  0.3,  0.2],   // base 20
  def: [0.2,  0.3,  3.0,  0.3,  0.2],   // base 20
  agi: [0.1,  0.2,  0.2,  2.0,  0.1],   // base 20
  spt: [-0.3, -0.1, 0.2,  -0.1, 0.8],   // base 100
  rec: [0.8,  -0.1, -0.1, 0.2,  -0.3],  // base 100
} as const;

export const STAT_BASE = {
  hp: 20, mp: 20, atk: 20, def: 20, agi: 20, spt: 100, rec: 100,
} as const;

// Initial growth rate (倍率) by card type
export const CARD_TYPE_RATE: Record<string, number> = {
  "金": 0.25,
  "銀": 0.20,
  "普": 0.15,
};
export const DEFAULT_RATE = 0.2;

// Stat labels in Chinese
export const FIVE_STAT_LABELS = ["體力", "力量", "強度", "速度", "魔法"] as const;
export const FIVE_STAT_SHORT = ["體", "力", "強", "速", "魔"] as const;
export const SEVEN_STAT_LABELS = ["HP", "MP", "攻擊", "防禦", "敏捷", "精神", "回復"] as const;

// Wash prices that exist in the data
export const WASH_PRICES = [10, 20, 28, 50, 66, 100, 166, 188, 200, 288, 300, 388, 500, 640, 800, 1200, 1600, 1800, 2400, 5000] as const;
