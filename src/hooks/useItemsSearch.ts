'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { queryKeys, cacheDurations } from '@/components/providers/QueryProvider';
import type { Item } from '@/types/supabase';

/**
 * Hook for searching items with autocomplete
 * Uses TanStack Query with 30-minute cache since item names rarely change
 */
export function useItemsSearch(searchTerm: string) {
  const supabase = createClient();

  return useQuery({
    queryKey: queryKeys.items.search(searchTerm),
    queryFn: async (): Promise<Item[]> => {
      if (!searchTerm || searchTerm.length < 2) {
        return [];
      }

      const { data, error } = await supabase
        .from('items')
        .select('*')
        .or(`name.ilike.%${searchTerm}%,name_simplified.ilike.%${searchTerm}%`)
        .order('name')
        .limit(10);

      if (error) {
        console.error('Error searching items:', error);
        return [];
      }

      return data || [];
    },
    // Cache for 30 minutes - item names don't change
    staleTime: cacheDurations.items,
    gcTime: cacheDurations.items * 2,
    // Only enable if we have a search term
    enabled: searchTerm.length >= 2,
  });
}

/**
 * Hook for getting all tracked item names (for quick lookup)
 * Heavily cached since this is just for display
 */
export function useTrackedItemNames() {
  const supabase = createClient();

  return useQuery({
    queryKey: ['trackedItemNames'],
    queryFn: async (): Promise<Set<string>> => {
      const { data, error } = await supabase
        .from('tracked_items')
        .select('items (name)')
        .eq('is_active', true);

      if (error) {
        console.error('Error fetching tracked item names:', error);
        return new Set();
      }

      const names = (data || [])
        .map(row => (row.items as { name: string } | null)?.name)
        .filter((name): name is string => !!name);

      return new Set(names);
    },
    staleTime: 60 * 1000, // 1 minute
    gcTime: 5 * 60 * 1000, // 5 minutes
  });
}
