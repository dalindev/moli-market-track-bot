'use client';

import { useState, useCallback } from 'react';
import type { MarketResponse, SearchParams, MarketItem, Stall } from '@/types/market';

export interface FlattenedItem extends MarketItem {
  stall: Stall;
  isMatch: boolean;
}

export function useMarket() {
  const [data, setData] = useState<MarketResponse | null>(null);
  const [matchingItems, setMatchingItems] = useState<FlattenedItem[]>([]);
  const [otherItems, setOtherItems] = useState<FlattenedItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const search = useCallback(async (params: Partial<SearchParams>) => {
    setLoading(true);
    setError(null);

    const term = params.search || '';
    setSearchTerm(term);

    const searchParams = new URLSearchParams({
      page: String(params.page || 1),
      search: term,
      type: params.type || 'all',
      server: params.server || 'all',
      exact: params.exact ? '1' : '0',
    });

    try {
      const response = await fetch(`/api/market?${searchParams.toString()}`);
      if (!response.ok) {
        throw new Error('Failed to fetch market data');
      }

      const result: MarketResponse = await response.json();
      setData(result);

      // Flatten items with stall info and mark matches
      const matching: FlattenedItem[] = [];
      const other: FlattenedItem[] = [];
      const stallMap = new Map(result.stalls.map(s => [s.cdkey, s]));

      for (const [cdkey, stallItems] of Object.entries(result.itemsByCd)) {
        const stall = stallMap.get(cdkey);
        if (stall) {
          for (const item of stallItems) {
            const isMatch = term ? item.ITEM_TRUENAME.includes(term) : true;
            const flatItem = { ...item, stall, isMatch };

            if (isMatch) {
              matching.push(flatItem);
            } else {
              other.push(flatItem);
            }
          }
        }
      }

      // Sort by price ascending
      matching.sort((a, b) => a.price - b.price);
      other.sort((a, b) => a.price - b.price);

      setMatchingItems(matching);
      setOtherItems(other);

      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return { data, matchingItems, otherItems, loading, error, search, searchTerm };
}
