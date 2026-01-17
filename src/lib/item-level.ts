// Item level helpers for 改造圖 type items
// Lv5 = 普通 (Normal) - Copper
// Lv6 = 银 (Silver) - Silver
// Lv7 = 金 (Gold) - Gold

export const LEVEL_NAMES: Record<number, string> = {
  5: '普通',
  6: '银',
  7: '金',
};

// Colors for each level (Tailwind classes)
export const LEVEL_COLORS: Record<number, { text: string; bg: string; border: string }> = {
  5: { text: 'text-orange-700', bg: 'bg-orange-100', border: 'border-orange-300' },    // Copper
  6: { text: 'text-slate-500', bg: 'bg-slate-100', border: 'border-slate-300' },       // Silver
  7: { text: 'text-yellow-600', bg: 'bg-yellow-100', border: 'border-yellow-400' },    // Gold
};

// Get the display suffix for an item level
export function getLevelSuffix(level: number | null | undefined): string {
  if (level == null) return '';
  const name = LEVEL_NAMES[level];
  return name ? ` (${name})` : level >= 5 ? ` (Lv${level})` : '';
}

// Get display name with level suffix
export function getItemDisplayName(name: string, level: number | null | undefined): string {
  return name + getLevelSuffix(level);
}

// Check if item has a meaningful level to display
export function hasDisplayLevel(level: number | null | undefined): boolean {
  return level != null && level >= 5;
}

// Get color classes for a level
export function getLevelColors(level: number | null | undefined): { text: string; bg: string; border: string } {
  if (level == null) return { text: '', bg: '', border: '' };
  return LEVEL_COLORS[level] ?? { text: 'text-gray-600', bg: 'bg-gray-100', border: 'border-gray-300' };
}
