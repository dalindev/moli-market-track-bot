'use client';

import { createClient } from '@/lib/supabase/client';

// Old localStorage types (from original useTrackedItems)
interface OldPriceRecord {
  price: number;
  server: number;
  stallName: string;
  coords: string;
  timestamp: string;
}

interface OldTrackedItem {
  id: string;
  itemName: string;
  itemId: number;
  targetPrice: number;
  alertThreshold: number;
  priceHistory: OldPriceRecord[];
  createdAt: string;
  lastChecked: string;
  isActive: boolean;
}

export interface MigrationResult {
  success: boolean;
  itemsMigrated: number;
  priceRecordsMigrated: number;
  errors: string[];
}

const OLD_STORAGE_KEY = 'market-tracker-items';
const MIGRATION_FLAG_KEY = 'market-tracker-migrated';

/**
 * Check if there's data to migrate from localStorage
 */
export function hasDataToMigrate(): boolean {
  if (typeof window === 'undefined') return false;

  // Already migrated
  if (localStorage.getItem(MIGRATION_FLAG_KEY) === 'true') {
    return false;
  }

  const stored = localStorage.getItem(OLD_STORAGE_KEY);
  if (!stored) return false;

  try {
    const items = JSON.parse(stored);
    return Array.isArray(items) && items.length > 0;
  } catch {
    return false;
  }
}

/**
 * Get the count of items to migrate
 */
export function getMigrationCount(): number {
  if (typeof window === 'undefined') return 0;

  const stored = localStorage.getItem(OLD_STORAGE_KEY);
  if (!stored) return 0;

  try {
    const items = JSON.parse(stored);
    return Array.isArray(items) ? items.length : 0;
  } catch {
    return 0;
  }
}

/**
 * Migrate data from localStorage to Supabase
 */
export async function migrateFromLocalStorage(): Promise<MigrationResult> {
  const result: MigrationResult = {
    success: false,
    itemsMigrated: 0,
    priceRecordsMigrated: 0,
    errors: [],
  };

  if (typeof window === 'undefined') {
    result.errors.push('Migration must run in browser');
    return result;
  }

  const stored = localStorage.getItem(OLD_STORAGE_KEY);
  if (!stored) {
    result.success = true;
    return result;
  }

  let oldItems: OldTrackedItem[];
  try {
    oldItems = JSON.parse(stored);
    if (!Array.isArray(oldItems)) {
      result.success = true;
      return result;
    }
  } catch (e) {
    result.errors.push(`Failed to parse localStorage data: ${e}`);
    return result;
  }

  const supabase = createClient();

  for (const oldItem of oldItems) {
    try {
      // 1. Upsert item to items table
      const { data: item, error: itemError } = await supabase
        .from('items')
        .upsert(
          {
            name: oldItem.itemName,
            item_type: 'item', // Assume item type, could be improved
            item_id: oldItem.itemId || null,
          },
          { onConflict: 'name' }
        )
        .select()
        .single();

      if (itemError) {
        result.errors.push(`Failed to create item "${oldItem.itemName}": ${itemError.message}`);
        continue;
      }

      // 2. Create tracked item
      const { error: trackError } = await supabase
        .from('tracked_items')
        .upsert(
          {
            item_id: item.id,
            alert_threshold: oldItem.alertThreshold || 50,
            target_price: oldItem.targetPrice || null,
            is_active: oldItem.isActive ?? true,
            created_at: oldItem.createdAt || new Date().toISOString(),
            last_checked: oldItem.lastChecked || new Date().toISOString(),
          },
          { onConflict: 'item_id' }
        );

      if (trackError) {
        result.errors.push(`Failed to track "${oldItem.itemName}": ${trackError.message}`);
        continue;
      }

      result.itemsMigrated++;

      // 3. Migrate price history
      if (oldItem.priceHistory && oldItem.priceHistory.length > 0) {
        const priceSnapshots = oldItem.priceHistory.map(record => ({
          item_id: item.id,
          price: record.price,
          pricetype: 0, // Old data didn't store pricetype, assume gold
          server: record.server || 0,
          stall_name: record.stallName || 'Unknown',
          stall_cdkey: 'migrated',
          coords: record.coords || '',
          source: 'market' as const,
          recorded_at: record.timestamp || new Date().toISOString(),
        }));

        const { error: snapshotError } = await supabase
          .from('price_snapshots')
          .insert(priceSnapshots);

        if (snapshotError) {
          result.errors.push(`Failed to migrate prices for "${oldItem.itemName}": ${snapshotError.message}`);
        } else {
          result.priceRecordsMigrated += priceSnapshots.length;
        }
      }

      // 4. Update statistics for this item
      await supabase.rpc('update_price_statistics', { p_item_id: item.id });
    } catch (err) {
      result.errors.push(`Error migrating "${oldItem.itemName}": ${err}`);
    }
  }

  // Mark migration as complete
  if (result.itemsMigrated > 0) {
    localStorage.setItem(MIGRATION_FLAG_KEY, 'true');
    // Optionally clear old data after successful migration
    // localStorage.removeItem(OLD_STORAGE_KEY);
  }

  result.success = result.errors.length === 0 || result.itemsMigrated > 0;
  return result;
}

/**
 * Clear the migration flag (for testing)
 */
export function resetMigrationFlag(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(MIGRATION_FLAG_KEY);
  }
}

/**
 * Clear old localStorage data after confirmed successful migration
 */
export function clearOldData(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(OLD_STORAGE_KEY);
  }
}
