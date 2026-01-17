'use client';

import { useState, useCallback, useRef } from 'react';
import type { MarketResponse, SearchParams, MarketItem, MarketPet, Stall } from '@/types/market';

export interface FlattenedItem {
  // Common fields
  name: string;
  price: number;
  pricetype: number;
  stall: Stall;
  isMatch: boolean;
  isPet: boolean;
  // Item-specific (optional)
  itemData?: MarketItem;
  // Pet-specific (optional)
  petData?: MarketPet;
}

// Delay between page fetches (ms)
const FETCH_DELAY = 500;
// Auto-fetch up to this many pages
const AUTO_FETCH_PAGES = 5;

// Helper to delay
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export function useMarket() {
  const [data, setData] = useState<MarketResponse | null>(null);
  const [matchingItems, setMatchingItems] = useState<FlattenedItem[]>([]);
  const [otherItems, setOtherItems] = useState<FlattenedItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [hasMore, setHasMore] = useState(false);

  // Store current search params and state for "load more"
  const searchStateRef = useRef<{
    params: Partial<SearchParams>;
    currentPage: number;
    totalPages: number;
    allMatching: FlattenedItem[];
    allOther: FlattenedItem[];
  } | null>(null);

  // Abort controller for cancelling ongoing fetches
  const abortControllerRef = useRef<AbortController | null>(null);

  const processPage = useCallback((result: MarketResponse, term: string, exactMatch: boolean, allMatching: FlattenedItem[], allOther: FlattenedItem[]) => {
    const stallMap = new Map(result.stalls.map(s => [s.cdkey, s]));

    // Process items
    for (const [cdkey, stallItems] of Object.entries(result.itemsByCd || {})) {
      const stall = stallMap.get(cdkey);
      if (stall) {
        for (const item of stallItems) {
          const itemName = item.ITEM_TRUENAME;
          const isMatch = term
            ? (exactMatch ? itemName === term : itemName.includes(term))
            : true;

          const flatItem: FlattenedItem = {
            name: itemName,
            price: item.price,
            pricetype: item.pricetype,
            stall,
            isMatch,
            isPet: false,
            itemData: item,
          };

          if (isMatch) {
            allMatching.push(flatItem);
          } else {
            allOther.push(flatItem);
          }
        }
      }
    }

    // Process pets
    for (const [cdkey, stallPets] of Object.entries(result.petsByCd || {})) {
      const stall = stallMap.get(cdkey);
      if (stall) {
        for (const pet of stallPets) {
          const petName = pet.Name;
          const isMatch = term
            ? (exactMatch ? petName === term : petName.includes(term))
            : true;

          const flatItem: FlattenedItem = {
            name: petName,
            price: pet.price,
            pricetype: pet.pricetype,
            stall,
            isMatch,
            isPet: true,
            petData: pet,
          };

          if (isMatch) {
            allMatching.push(flatItem);
          } else {
            allOther.push(flatItem);
          }
        }
      }
    }
  }, []);

  const search = useCallback(async (params: Partial<SearchParams>) => {
    // Cancel any ongoing fetch
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    setLoading(true);
    setError(null);
    setProgress(null);
    setHasMore(false);

    const term = params.search || '';
    setSearchTerm(term);

    const baseParams = {
      search: term,
      type: params.type || 'all',
      server: params.server || 'all',
      exact: params.exact ? '1' : '0',
    };

    try {
      // Fetch first page to get total count
      const firstPageParams = new URLSearchParams({ ...baseParams, page: '1' });
      const firstResponse = await fetch(`/api/market?${firstPageParams.toString()}`, { signal });

      if (!firstResponse.ok) {
        throw new Error('Failed to fetch market data');
      }

      const firstResult: MarketResponse = await firstResponse.json();
      const totalPages = Math.ceil(firstResult.totalFiltered / firstResult.perPage);

      setData(firstResult);
      setProgress({ current: 1, total: totalPages });

      // Collect all items
      const allMatching: FlattenedItem[] = [];
      const allOther: FlattenedItem[] = [];

      const exactMatch = params.exact ?? true; // Default to exact match
      processPage(firstResult, term, exactMatch, allMatching, allOther);

      // Update UI after first page
      allMatching.sort((a, b) => a.price - b.price);
      allOther.sort((a, b) => a.price - b.price);
      setMatchingItems([...allMatching]);
      setOtherItems([...allOther]);

      // Auto-fetch up to AUTO_FETCH_PAGES
      const autoFetchLimit = Math.min(totalPages, AUTO_FETCH_PAGES);

      for (let page = 2; page <= autoFetchLimit; page++) {
        if (signal.aborted) break;

        await delay(FETCH_DELAY);

        if (signal.aborted) break;

        const pageParams = new URLSearchParams({ ...baseParams, page: String(page) });
        const pageResponse = await fetch(`/api/market?${pageParams.toString()}`, { signal });

        if (!pageResponse.ok) {
          console.warn(`Failed to fetch page ${page}`);
          continue;
        }

        const pageResult: MarketResponse = await pageResponse.json();
        processPage(pageResult, term, exactMatch, allMatching, allOther);

        // Update UI progressively
        allMatching.sort((a, b) => a.price - b.price);
        allOther.sort((a, b) => a.price - b.price);
        setMatchingItems([...allMatching]);
        setOtherItems([...allOther]);
        setProgress({ current: page, total: totalPages });
      }

      // Store state for "load more"
      searchStateRef.current = {
        params,
        currentPage: autoFetchLimit,
        totalPages,
        allMatching,
        allOther,
      };

      // Check if there are more pages
      setHasMore(totalPages > autoFetchLimit);
      setProgress(null);
      return firstResult;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return null;
      }
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      return null;
    } finally {
      setLoading(false);
      setProgress(null);
    }
  }, [processPage]);

  const loadMore = useCallback(async () => {
    const state = searchStateRef.current;
    if (!state || state.currentPage >= state.totalPages) return;

    // Cancel any ongoing fetch
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    setLoadingMore(true);

    const term = state.params.search || '';
    const baseParams = {
      search: term,
      type: state.params.type || 'all',
      server: state.params.server || 'all',
      exact: state.params.exact ? '1' : '0',
    };

    try {
      // Load next batch of pages (up to AUTO_FETCH_PAGES more)
      const startPage = state.currentPage + 1;
      const endPage = Math.min(state.totalPages, state.currentPage + AUTO_FETCH_PAGES);

      for (let page = startPage; page <= endPage; page++) {
        if (signal.aborted) break;

        if (page > startPage) {
          await delay(FETCH_DELAY);
        }

        if (signal.aborted) break;

        const pageParams = new URLSearchParams({ ...baseParams, page: String(page) });
        const pageResponse = await fetch(`/api/market?${pageParams.toString()}`, { signal });

        if (!pageResponse.ok) {
          console.warn(`Failed to fetch page ${page}`);
          continue;
        }

        const pageResult: MarketResponse = await pageResponse.json();
        const exactMatch = state.params.exact ?? true;
        processPage(pageResult, term, exactMatch, state.allMatching, state.allOther);

        // Update UI progressively
        state.allMatching.sort((a, b) => a.price - b.price);
        state.allOther.sort((a, b) => a.price - b.price);
        setMatchingItems([...state.allMatching]);
        setOtherItems([...state.allOther]);
        setProgress({ current: page, total: state.totalPages });

        state.currentPage = page;
      }

      setHasMore(state.currentPage < state.totalPages);
      setProgress(null);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      console.error('Error loading more:', err);
    } finally {
      setLoadingMore(false);
      setProgress(null);
    }
  }, [processPage]);

  return { data, matchingItems, otherItems, loading, loadingMore, error, search, searchTerm, progress, hasMore, loadMore };
}
