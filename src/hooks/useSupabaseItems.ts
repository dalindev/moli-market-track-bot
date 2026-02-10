'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Item, TrackedItem, PriceSnapshotInsert } from '@/types/supabase';

// Default exchange rate fallback (matches DB default)
const DEFAULT_CRYSTAL_RATE = 263;

export interface RecentListing {
  price: number;
  pricetype: number;
  server: number;
  stallName: string;
  coords: string;
  quantity: number;
  recordedAt: string;
  priceInGold: number;
  percentBelowAvg: number | null;
}

export interface TrackedItemDisplay {
  id: string;
  itemName: string;
  itemId: number | null;
  itemUuid: string;  // The UUID of the item in items table
  itemLevel: number | null;  // 5=普通, 6=银, 7=金 - for filtering API results
  alertThreshold: number;
  targetPrice: number | null;
  priceOverride: number | null;  // User-set reference price override
  isActive: boolean;
  createdAt: string;
  lastChecked: string;
  // Statistics (median price, not average)
  medianPriceGold: number | null;  // Calculated median from price_statistics
  referencePrice: number | null;   // priceOverride ?? medianPriceGold (use this for alerts)
  minPrice7d: number | null;
  maxPrice7d: number | null;
  transactionCount7d: number | null;
  lastSeenPrice: number | null;
  lastSeenPricetype: number | null;
  // Recent listings (top 10 lowest prices in last 24h)
  recentListings: RecentListing[];
}

export interface AlertCheckResult {
  triggered: boolean;
  currentPrice: number;
  averagePrice: number;
  percentBelow: number;
  threshold: number;
  currencyMismatch?: boolean;
}

export function useSupabaseItems(exchangeRate?: number) {
  const [trackedItems, setTrackedItems] = useState<TrackedItemDisplay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const supabase = createClient();
  const crystalToGoldRate = exchangeRate ?? DEFAULT_CRYSTAL_RATE;

  // Fetch all tracked items with their statistics
  const fetchTrackedItems = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Fetch tracked items with items
      const { data, error: fetchError } = await supabase
        .from('tracked_items')
        .select(`
          *,
          items (*)
        `)
        .order('created_at', { ascending: false });

      if (fetchError) throw fetchError;

      // Fetch price_statistics for all items
      const itemIds = (data || []).map(row => row.items?.id).filter(Boolean);
      const { data: stats } = itemIds.length > 0
        ? await supabase
            .from('price_statistics')
            .select('*')
            .in('item_id', itemIds)
        : { data: [] };

      const statsMap = new Map((stats || []).map(s => [s.item_id, s]));

      // Fetch current market listings only (source='market')
      // These are active listings, not transaction history
      // Old market listings are cleared when refreshing, so stale data won't appear
      const { data: recentSnapshots } = itemIds.length > 0
        ? await supabase
            .from('price_snapshots')
            .select('*')
            .in('item_id', itemIds)
            .eq('source', 'market')
            .order('recorded_at', { ascending: false })
            .limit(200)
        : { data: [] };

      // Group snapshots by item_id
      const snapshotsMap = new Map<string, typeof recentSnapshots>();
      for (const snapshot of recentSnapshots || []) {
        const existing = snapshotsMap.get(snapshot.item_id) || [];
        existing.push(snapshot);
        snapshotsMap.set(snapshot.item_id, existing);
      }

      const items: TrackedItemDisplay[] = (data || []).map((row) => {
        const item = row.items as Item;
        const priceStats = statsMap.get(item?.id);
        const medianPriceGold = priceStats?.avg_price_gold ?? null; // Now stores median
        const priceOverride = row.price_override ?? null;
        // Use override if set, otherwise use calculated median
        const referencePrice = priceOverride ?? medianPriceGold;

        // Get recent listings for this item, sorted by price (lowest first)
        const itemSnapshots = snapshotsMap.get(item?.id) || [];
        const recentListings: RecentListing[] = itemSnapshots
          .map(s => {
            const priceInGold = s.pricetype === 1 ? s.price * crystalToGoldRate : s.price;
            return {
              price: s.price,
              pricetype: s.pricetype,
              server: s.server,
              stallName: s.stall_name,
              coords: s.coords,
              quantity: s.quantity ?? 1,
              recordedAt: s.recorded_at,
              priceInGold,
              // Use referencePrice for % below calculation
              percentBelowAvg: referencePrice
                ? Math.round(((referencePrice - priceInGold) / referencePrice) * 100)
                : null,
            };
          })
          // Sort by priceInGold (lowest first), then take top 10
          .sort((a, b) => a.priceInGold - b.priceInGold)
          .slice(0, 10);

        return {
          id: row.id,
          itemName: item?.name ?? 'Unknown',
          itemId: item?.item_id ?? null,
          itemUuid: item?.id ?? '',
          itemLevel: item?.item_level ?? null,
          alertThreshold: row.alert_threshold,
          targetPrice: row.target_price,
          priceOverride,
          isActive: row.is_active,
          createdAt: row.created_at,
          lastChecked: row.last_checked,
          medianPriceGold,
          referencePrice,
          minPrice7d: priceStats?.min_price_7d ?? null,
          maxPrice7d: priceStats?.max_price_7d ?? null,
          transactionCount7d: priceStats?.transaction_count_7d ?? null,
          lastSeenPrice: priceStats?.last_seen_price ?? null,
          lastSeenPricetype: priceStats?.last_seen_pricetype ?? null,
          recentListings,
        };
      });

      setTrackedItems(items);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch tracked items';
      setError(message);
      console.error('Error fetching tracked items:', err);
    } finally {
      setLoading(false);
    }
  }, [supabase, crystalToGoldRate]);

  // Load tracked items on mount
  useEffect(() => {
    fetchTrackedItems();
  }, [fetchTrackedItems]);

  // Add or get an item by name (and level for items with different levels)
  const upsertItem = useCallback(async (
    name: string,
    itemType: 'item' | 'pet',
    itemId?: number,
    baseImageNumber?: number,
    itemLevel?: number | null
  ): Promise<Item | null> => {
    try {
      // Try to find existing item by name and level
      // For items with levels, we need to match both name and level
      let query = supabase
        .from('items')
        .select('*')
        .eq('name', name);

      // If level is provided, match it; otherwise look for items without level
      if (itemLevel != null) {
        query = query.eq('item_level', itemLevel);
      } else {
        query = query.is('item_level', null);
      }

      const { data: existing } = await query.single();

      if (existing) {
        return existing;
      }

      // Insert new item
      const { data: newItem, error: insertError } = await supabase
        .from('items')
        .insert({
          name,
          item_type: itemType,
          item_id: itemId ?? null,
          item_level: itemLevel ?? null,
          base_image_number: baseImageNumber ?? null,
        })
        .select()
        .single();

      if (insertError) throw insertError;
      return newItem;
    } catch (err) {
      console.error('Error upserting item:', err);
      return null;
    }
  }, [supabase]);

  // Add item to tracking
  const addTrackedItem = useCallback(async (
    itemName: string,
    itemType: 'item' | 'pet',
    itemId?: number,
    baseImageNumber?: number,
    alertThreshold: number = 50,
    targetPrice?: number,
    itemLevel?: number | null
  ): Promise<boolean> => {
    try {
      // Upsert the item first (including level for items)
      const item = await upsertItem(itemName, itemType, itemId, baseImageNumber, itemLevel);
      if (!item) {
        setError('Failed to create item');
        return false;
      }

      // Check if already tracking
      const { data: existing } = await supabase
        .from('tracked_items')
        .select('id')
        .eq('item_id', item.id)
        .single();

      if (existing) {
        setError('Item is already being tracked');
        return false;
      }

      // Add to tracked items
      const { error: trackError } = await supabase
        .from('tracked_items')
        .insert({
          item_id: item.id,
          alert_threshold: alertThreshold,
          target_price: targetPrice ?? null,
        });

      if (trackError) throw trackError;

      // Refresh the list
      await fetchTrackedItems();
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to add tracked item';
      setError(message);
      console.error('Error adding tracked item:', err);
      return false;
    }
  }, [supabase, upsertItem, fetchTrackedItems]);

  // Remove item from tracking
  const removeTrackedItem = useCallback(async (id: string): Promise<boolean> => {
    try {
      const { error: deleteError } = await supabase
        .from('tracked_items')
        .delete()
        .eq('id', id);

      if (deleteError) throw deleteError;

      setTrackedItems(prev => prev.filter(item => item.id !== id));
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to remove tracked item';
      setError(message);
      console.error('Error removing tracked item:', err);
      return false;
    }
  }, [supabase]);

  // Update tracked item settings
  const updateTrackedItem = useCallback(async (
    id: string,
    updates: { alertThreshold?: number; targetPrice?: number | null; priceOverride?: number | null; isActive?: boolean }
  ): Promise<boolean> => {
    try {
      const updateData: Partial<TrackedItem> = {};
      if (updates.alertThreshold !== undefined) updateData.alert_threshold = updates.alertThreshold;
      if (updates.targetPrice !== undefined) updateData.target_price = updates.targetPrice;
      if (updates.priceOverride !== undefined) updateData.price_override = updates.priceOverride;
      if (updates.isActive !== undefined) updateData.is_active = updates.isActive;

      const { error: updateError } = await supabase
        .from('tracked_items')
        .update(updateData)
        .eq('id', id);

      if (updateError) throw updateError;

      setTrackedItems(prev => prev.map(item => {
        if (item.id !== id) return item;
        const newPriceOverride = updates.priceOverride !== undefined ? updates.priceOverride : item.priceOverride;
        return {
          ...item,
          alertThreshold: updates.alertThreshold ?? item.alertThreshold,
          targetPrice: updates.targetPrice !== undefined ? updates.targetPrice : item.targetPrice,
          priceOverride: newPriceOverride,
          referencePrice: newPriceOverride ?? item.medianPriceGold,
          isActive: updates.isActive ?? item.isActive,
        };
      }));
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update tracked item';
      setError(message);
      console.error('Error updating tracked item:', err);
      return false;
    }
  }, [supabase]);

  // Save price snapshots with deduplication
  // Uses upsert logic: same item + stall + price = update, not duplicate
  // If clearOldMarketListings is true, removes old market snapshots first (for fresh refresh)
  const savePriceSnapshots = useCallback(async (
    itemName: string,
    snapshots: Omit<PriceSnapshotInsert, 'item_id'>[],
    clearOldMarketListings: boolean = false
  ): Promise<{ success: boolean; inserted: number; updated: number; deleted: number }> => {
    try {
      // Get item ID
      const { data: item, error: itemError } = await supabase
        .from('items')
        .select('id')
        .eq('name', itemName)
        .single();

      if (itemError) {
        console.error('Error finding item:', itemError.message, itemError.details);
        return { success: false, inserted: 0, updated: 0, deleted: 0 };
      }

      if (!item) {
        console.warn(`Item not found: ${itemName}`);
        return { success: false, inserted: 0, updated: 0, deleted: 0 };
      }

      let inserted = 0;
      let updated = 0;
      let deleted = 0;

      // Clear old market listings if requested (keeps transaction history)
      if (clearOldMarketListings) {
        const { count } = await supabase
          .from('price_snapshots')
          .delete({ count: 'exact' })
          .eq('item_id', item.id)
          .eq('source', 'market');
        deleted = count ?? 0;
      }

      // Process each snapshot with upsert logic
      for (const snapshot of snapshots) {
        // Generate listing key for deduplication
        const listingKey = `${item.id}:${snapshot.stall_cdkey}:${snapshot.price}:${snapshot.pricetype}`;

        // Try to find existing record with same listing key
        const { data: existing } = await supabase
          .from('price_snapshots')
          .select('id')
          .eq('listing_key', listingKey)
          .eq('source', 'market')
          .single();

        if (existing) {
          // Update existing record
          const { error: updateError } = await supabase
            .from('price_snapshots')
            .update({
              quantity: snapshot.quantity ?? 1,
              recorded_at: new Date().toISOString(),
              server: snapshot.server,
              stall_name: snapshot.stall_name,
              coords: snapshot.coords,
            })
            .eq('id', existing.id);

          if (updateError) {
            console.error('Error updating snapshot:', updateError.message);
          } else {
            updated++;
          }
        } else {
          // Insert new record
          const { error: insertError } = await supabase
            .from('price_snapshots')
            .insert({
              item_id: item.id,
              price: snapshot.price,
              pricetype: snapshot.pricetype,
              server: snapshot.server,
              stall_name: snapshot.stall_name,
              stall_cdkey: snapshot.stall_cdkey,
              coords: snapshot.coords,
              quantity: snapshot.quantity ?? 1,
              source: 'market',
              listing_key: listingKey,
            });

          if (insertError) {
            console.error('Error inserting snapshot:', insertError.message);
          } else {
            inserted++;
          }
        }
      }

      // Update statistics
      const { error: statsError } = await supabase.rpc('update_price_statistics', { p_item_id: item.id });
      if (statsError) {
        console.error('Error updating statistics:', statsError.message);
      }

      return { success: true, inserted, updated, deleted };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : JSON.stringify(err);
      console.error('Error saving price snapshots:', errorMessage);
      return { success: false, inserted: 0, updated: 0, deleted: 0 };
    }
  }, [supabase]);

  // Save transaction history snapshots (deduplication by transaction_id)
  const saveTransactionSnapshots = useCallback(async (
    itemUuid: string,
    transactions: Array<{
      transactionId: number;
      price: number;
      pricetype: number;
      quantity: number;
      buyerName: string;
      recordedAt: string;
    }>
  ): Promise<{ success: boolean; inserted: number }> => {
    try {
      let inserted = 0;

      for (const txn of transactions) {
        const { data: result, error: upsertError } = await supabase.rpc('upsert_transaction', {
          p_item_id: itemUuid,
          p_transaction_id: txn.transactionId,
          p_price: txn.price,
          p_pricetype: txn.pricetype,
          p_stall_name: txn.buyerName || 'Unknown',
          p_stall_cdkey: '',
          p_quantity: txn.quantity,
          p_recorded_at: txn.recordedAt,
        });

        if (!upsertError && result === 'inserted') {
          inserted++;
        } else if (upsertError) {
          console.error('Error upserting transaction:', upsertError.message);
        }
      }

      // Recalculate statistics with new transaction data
      const { error: statsError } = await supabase.rpc('update_price_statistics', { p_item_id: itemUuid });
      if (statsError) {
        console.error('Error updating statistics:', statsError.message);
      }

      return { success: true, inserted };
    } catch (err) {
      console.error('Error saving transaction snapshots:', err);
      return { success: false, inserted: 0 };
    }
  }, [supabase]);

  // Check if price triggers an alert
  const checkAlert = useCallback((
    trackedItem: TrackedItemDisplay,
    currentPrice: number,
    currentPriceType: number
  ): AlertCheckResult | null => {
    // Use referencePrice (override or median)
    if (!trackedItem.isActive || !trackedItem.referencePrice) {
      return null;
    }

    // Normalize to gold
    const goldPrice = currentPriceType === 1
      ? currentPrice * crystalToGoldRate
      : currentPrice;

    const percentBelow = ((trackedItem.referencePrice - goldPrice) / trackedItem.referencePrice) * 100;

    // Detect currency mismatch: item listed in gold but price matches typical crystal range
    // e.g., 5000 crystal item listed for 5000 gold (should be ~1,315,000 gold)
    let currencyMismatch = false;
    if (currentPriceType === 0 && trackedItem.referencePrice > 0) {
      const expectedCrystalPrice = trackedItem.referencePrice / crystalToGoldRate;
      // If the gold price is close to what the crystal price would be, flag it
      if (currentPrice <= expectedCrystalPrice * 1.5 && currentPrice >= expectedCrystalPrice * 0.3) {
        currencyMismatch = true;
      }
    }

    return {
      triggered: percentBelow >= trackedItem.alertThreshold || currencyMismatch,
      currentPrice: goldPrice,
      averagePrice: trackedItem.referencePrice,
      percentBelow: Math.round(percentBelow),
      threshold: trackedItem.alertThreshold,
      currencyMismatch,
    };
  }, [crystalToGoldRate]);

  // Get item by name
  const getItemByName = useCallback(async (name: string): Promise<Item | null> => {
    try {
      const { data, error: fetchError } = await supabase
        .from('items')
        .select('*')
        .eq('name', name)
        .single();

      if (fetchError) return null;
      return data;
    } catch {
      return null;
    }
  }, [supabase]);

  // Search items by name (partial match)
  const searchItems = useCallback(async (searchTerm: string): Promise<Item[]> => {
    try {
      const { data, error: searchError } = await supabase
        .from('items')
        .select('*')
        .or(`name.ilike.%${searchTerm}%,name_simplified.ilike.%${searchTerm}%`)
        .limit(20);

      if (searchError) throw searchError;
      return data || [];
    } catch (err) {
      console.error('Error searching items:', err);
      return [];
    }
  }, [supabase]);

  // Update last checked timestamp
  const updateLastChecked = useCallback(async (id: string): Promise<void> => {
    try {
      await supabase
        .from('tracked_items')
        .update({ last_checked: new Date().toISOString() })
        .eq('id', id);
    } catch (err) {
      console.error('Error updating last checked:', err);
    }
  }, [supabase]);

  return {
    trackedItems,
    loading,
    error,
    fetchTrackedItems,
    addTrackedItem,
    removeTrackedItem,
    updateTrackedItem,
    savePriceSnapshots,
    saveTransactionSnapshots,
    checkAlert,
    getItemByName,
    searchItems,
    upsertItem,
    updateLastChecked,
  };
}
