'use client';

import { useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import type { ExchangeRate } from '@/types/supabase';
import { queryKeys, cacheDurations } from '@/components/providers/QueryProvider';

// The special item that represents 1 million gold
const GOLD_BOX_NAME = '魔幣箱（100萬）';
const GOLD_BOX_VALUE = 1000000; // 1 million gold

// Default exchange rate fallback
const DEFAULT_GOLD_PER_CRYSTAL = 263;

export interface ExchangeRateInfo {
  goldPerCrystal: number;
  rateDate: string;
  sourcePrice: number | null;
  sampleCount: number;
  lastUpdated: string;
}

export function useExchangeRate() {
  const supabase = createClient();
  const queryClient = useQueryClient();

  // Fetch current exchange rate with React Query caching
  const currentRateQuery = useQuery({
    queryKey: queryKeys.exchangeRate.current,
    queryFn: async (): Promise<ExchangeRateInfo> => {
      const { data, error: fetchError } = await supabase
        .from('exchange_rates')
        .select('*')
        .order('rate_date', { ascending: false })
        .limit(1)
        .single();

      if (fetchError && fetchError.code !== 'PGRST116') {
        throw fetchError;
      }

      if (data) {
        return {
          goldPerCrystal: data.gold_per_crystal,
          rateDate: data.rate_date,
          sourcePrice: data.source_item_price,
          sampleCount: data.sample_count,
          lastUpdated: data.updated_at,
        };
      }

      // No rate found, use default
      return {
        goldPerCrystal: DEFAULT_GOLD_PER_CRYSTAL,
        rateDate: new Date().toISOString().split('T')[0],
        sourcePrice: null,
        sampleCount: 0,
        lastUpdated: new Date().toISOString(),
      };
    },
    staleTime: cacheDurations.exchangeRate, // 5 minutes cache
  });

  // Fetch rate history (last 30 days) with React Query caching
  const rateHistoryQuery = useQuery({
    queryKey: queryKeys.exchangeRate.history,
    queryFn: async (): Promise<ExchangeRate[]> => {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const { data, error: fetchError } = await supabase
        .from('exchange_rates')
        .select('*')
        .gte('rate_date', thirtyDaysAgo.toISOString().split('T')[0])
        .order('rate_date', { ascending: true });

      if (fetchError) throw fetchError;
      return data || [];
    },
    staleTime: cacheDurations.exchangeRate, // 5 minutes cache
  });

  // Update exchange rate from a gold box price
  const updateRateMutation = useMutation({
    mutationFn: async ({
      crystalPrice,
      sourceType = 'market',
    }: {
      crystalPrice: number;
      sourceType?: 'market' | 'transaction';
    }): Promise<number> => {
      const goldPerCrystal = GOLD_BOX_VALUE / crystalPrice;
      const today = new Date().toISOString().split('T')[0];

      // Check if we already have a rate for today
      const { data: existing } = await supabase
        .from('exchange_rates')
        .select('*')
        .eq('rate_date', today)
        .single();

      if (existing) {
        // Update with weighted average
        const newSampleCount = existing.sample_count + 1;
        const newRate = (existing.gold_per_crystal * existing.sample_count + goldPerCrystal) / newSampleCount;

        await supabase
          .from('exchange_rates')
          .update({
            gold_per_crystal: Math.round(newRate * 100) / 100,
            source_item_price: crystalPrice,
            source_type: sourceType,
            sample_count: newSampleCount,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id);
      } else {
        // Insert new rate
        await supabase
          .from('exchange_rates')
          .insert({
            rate_date: today,
            gold_per_crystal: Math.round(goldPerCrystal * 100) / 100,
            source_item_name: GOLD_BOX_NAME,
            source_item_price: crystalPrice,
            source_type: sourceType,
            sample_count: 1,
          });
      }

      return goldPerCrystal;
    },
    onSuccess: () => {
      // Invalidate cache to refetch fresh data
      queryClient.invalidateQueries({ queryKey: queryKeys.exchangeRate.current });
      queryClient.invalidateQueries({ queryKey: queryKeys.exchangeRate.history });
    },
  });

  const currentRate = currentRateQuery.data ?? null;
  const rateHistory = rateHistoryQuery.data ?? [];
  const loading = currentRateQuery.isLoading || rateHistoryQuery.isLoading;
  const error = currentRateQuery.error?.message ?? rateHistoryQuery.error?.message ?? null;

  // Convert crystal price to gold equivalent
  const crystalToGold = useCallback((crystalPrice: number): number => {
    const rate = currentRate?.goldPerCrystal ?? DEFAULT_GOLD_PER_CRYSTAL;
    return Math.round(crystalPrice * rate);
  }, [currentRate]);

  // Convert gold price to crystal equivalent
  const goldToCrystal = useCallback((goldPrice: number): number => {
    const rate = currentRate?.goldPerCrystal ?? DEFAULT_GOLD_PER_CRYSTAL;
    return Math.round(goldPrice / rate);
  }, [currentRate]);

  // Wrapper for backward compatibility
  const updateRateFromGoldBox = useCallback(async (
    crystalPrice: number,
    sourceType: 'market' | 'transaction' = 'market'
  ): Promise<number | null> => {
    try {
      return await updateRateMutation.mutateAsync({ crystalPrice, sourceType });
    } catch {
      return null;
    }
  }, [updateRateMutation]);

  const fetchCurrentRate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.exchangeRate.current });
  }, [queryClient]);

  const fetchRateHistory = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.exchangeRate.history });
  }, [queryClient]);

  return {
    currentRate,
    rateHistory,
    loading,
    error,
    fetchCurrentRate,
    fetchRateHistory,
    updateRateFromGoldBox,
    crystalToGold,
    goldToCrystal,
    GOLD_BOX_NAME,
    DEFAULT_GOLD_PER_CRYSTAL,
  };
}
