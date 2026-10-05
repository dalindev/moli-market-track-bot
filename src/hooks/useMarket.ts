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
// Client-side attempts per page. /api/market already retries the upstream; this covers the case
// where it exhausts its own budget (the game server sheds load with a transient 503 service_busy).
const PAGE_ATTEMPTS = 3;
// Cap on how long we honour an upstream-suggested retry delay before giving up on a page.
const MAX_RETRY_WAIT_MS = 8_000;

// Helper to delay. Signal-aware: an abort resolves it immediately instead of leaving a superseded
// search parked for the full interval before it notices it has been replaced.
const delay = (ms: number, signal?: AbortSignal) => new Promise<void>(resolve => {
  if (signal?.aborted) return resolve();
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
});

interface ApiErrorBody {
  error?: string;
  code?: string;
  retryAfter?: number;
}

/** Turns the proxy's error payload into something a user can act on. */
function describeFailure(status: number, body: ApiErrorBody | null): string {
  if (body?.code === 'service_busy') return '遊戲伺服器忙碌中，請稍後再試';
  if (body?.code === 'invalid_query') return `查詢條件錯誤（${body.error ?? 'invalid_query'}）`;
  if (status === 0) return '網路連線失敗';
  return body?.error ? `${body.error}（HTTP ${status}）` : `讀取市場資料失敗（HTTP ${status}）`;
}

/**
 * Fetches one market page, retrying transient failures. Returns the parsed page, or an
 * error description when every attempt failed. Aborts propagate as `aborted`.
 */
async function fetchPageWithRetry(
  url: string,
  signal: AbortSignal
): Promise<
  | { status: 'ok'; result: MarketResponse }
  | { status: 'aborted' }
  | { status: 'error'; message: string }
> {
  let message = '讀取市場資料失敗';

  for (let attempt = 1; attempt <= PAGE_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, { signal });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return { status: 'aborted' };
      message = describeFailure(0, null);
      if (attempt === PAGE_ATTEMPTS) break;
      await delay(FETCH_DELAY * attempt);
      if (signal.aborted) return { status: 'aborted' };
      continue;
    }

    if (response.ok) {
      try {
        return { status: 'ok', result: (await response.json()) as MarketResponse };
      } catch {
        message = '市場資料格式錯誤';
        break;
      }
    }

    const body = await response.json().catch(() => null) as ApiErrorBody | null;
    message = describeFailure(response.status, body);

    // A 4xx other than 429 is our own bad request — retrying cannot help.
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === PAGE_ATTEMPTS) break;

    const suggestedMs = (body?.retryAfter ?? 0) * 1000;
    const waitMs = suggestedMs > 0 ? suggestedMs : FETCH_DELAY * 2 ** (attempt - 1);
    if (waitMs > MAX_RETRY_WAIT_MS) break;

    await delay(waitMs);
    if (signal.aborted) return { status: 'aborted' };
  }

  return { status: 'error', message };
}

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
  // Pages that failed after retries. Surfaced so the UI can say results are incomplete.
  const [failedPages, setFailedPages] = useState(0);

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

  // Last search params, so a failed search can be retried without the caller re-supplying them
  const lastParamsRef = useRef<Partial<SearchParams> | null>(null);

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
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const signal = controller.signal;

    // Aborting only stops the in-flight fetch — this function keeps running to its end. Every
    // state write past an await must therefore check it is still the live search, or a superseded
    // run will clobber the one that replaced it (stale results, wrong cursor, lost spinner).
    const isCurrent = () => abortControllerRef.current === controller && !signal.aborted;

    setLoading(true);
    setError(null);
    setProgress(null);
    setHasMore(false);
    setFailedPages(0);

    const term = params.search || '';
    setSearchTerm(term);
    lastParamsRef.current = params;

    const baseParams = {
      search: term,
      type: params.type || 'all',
      server: params.server || 'all',
      exact: params.exact ? '1' : '0',
    };

    try {
      // Fetch first page to get total count
      const firstPageParams = new URLSearchParams({ ...baseParams, page: '1' });
      const firstPage = await fetchPageWithRetry(`/api/market?${firstPageParams.toString()}`, signal);

      if (firstPage.status === 'aborted') return null;
      if (firstPage.status === 'error') {
        setError(firstPage.message);
        return null;
      }

      const firstResult = firstPage.result;
      const totalPages = Math.ceil(firstResult.totalFiltered / firstResult.perPage);

      setData(firstResult);
      setProgress({ current: 1, total: totalPages });

      // Collect all items
      const allMatching: FlattenedItem[] = [];
      const allOther: FlattenedItem[] = [];
      let failed = 0;

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

        await delay(FETCH_DELAY, signal);

        if (signal.aborted) break;

        const pageParams = new URLSearchParams({ ...baseParams, page: String(page) });
        const page_ = await fetchPageWithRetry(`/api/market?${pageParams.toString()}`, signal);

        if (page_.status === 'aborted') break;
        if (page_.status === 'error') {
          // Don't fail the whole search over one page, but don't hide it either — a deal
          // finder that silently drops listings is worse than one that admits the gap.
          console.warn(`Failed to fetch page ${page}: ${page_.message}`);
          failed += 1;
          setFailedPages(failed);
          continue;
        }

        const pageResult = page_.result;
        processPage(pageResult, term, exactMatch, allMatching, allOther);

        if (!isCurrent()) break;

        // Update UI progressively
        allMatching.sort((a, b) => a.price - b.price);
        allOther.sort((a, b) => a.price - b.price);
        setMatchingItems([...allMatching]);
        setOtherItems([...allOther]);
        setProgress({ current: page, total: totalPages });
      }

      // A superseded search must not overwrite the live search's pagination cursor or results.
      if (!isCurrent()) return null;

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
      if (isCurrent()) setError(message);
      return null;
    } finally {
      // Without this guard a superseded search clears the spinner of the search that replaced it,
      // flashing "no results" while a scan is genuinely still running.
      if (isCurrent()) {
        setLoading(false);
        setProgress(null);
      }
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
          await delay(FETCH_DELAY, signal);
        }

        if (signal.aborted) break;

        const pageParams = new URLSearchParams({ ...baseParams, page: String(page) });
        const page_ = await fetchPageWithRetry(`/api/market?${pageParams.toString()}`, signal);

        if (page_.status === 'aborted') break;
        if (page_.status === 'error') {
          console.warn(`Failed to fetch page ${page}: ${page_.message}`);
          setFailedPages((n) => n + 1);
          // Still advance the cursor, otherwise the auto-paginate effect retries this page forever.
          state.currentPage = page;
          continue;
        }

        const pageResult = page_.result;
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

  /** Re-runs the last search. Used by error states so the user isn't stuck on a dead page. */
  const retry = useCallback(async () => {
    const params = lastParamsRef.current;
    if (!params) return null;
    return search(params);
  }, [search]);

  return {
    data,
    matchingItems,
    otherItems,
    loading,
    loadingMore,
    error,
    search,
    searchTerm,
    progress,
    hasMore,
    loadMore,
    retry,
    failedPages,
  };
}
