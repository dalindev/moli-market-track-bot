'use client';

import { useState, useCallback, useRef } from 'react';
import type { PriceHistoryResponseRaw, PriceHistoryLogRaw, PriceHistoryLog, PriceHistorySearchParams } from '@/types/market';

// Delay between page fetches (ms)
const FETCH_DELAY = 500;
// Max pages to fetch (20 items per page, ~100 items max to avoid API spam)
const MAX_PAGES = 5;

// Helper to delay
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Parse raw log from API to our format
function parseLog(raw: PriceHistoryLogRaw): PriceHistoryLog {
  // buff format: "購買1個：聖誕麋鹿" or "購買1隻：聖誕麋鹿雪橇"
  const buff = raw.buff || '';

  // Determine type based on unit (隻 = pet, 個 = item)
  const isPet = buff.includes('隻');

  // Extract item name after the colon (：)
  // e.g., "購買1隻：聖誕麋鹿雪橇" -> "聖誕麋鹿雪橇"
  let itemName = buff;
  const colonIndex = buff.indexOf('：');
  if (colonIndex !== -1) {
    itemName = buff.substring(colonIndex + 1).trim();
  }

  // Extract quantity (number after 購買)
  let quantity = 1;
  const quantityMatch = buff.match(/購買(\d+)/);
  if (quantityMatch) {
    quantity = parseInt(quantityMatch[1], 10);
  }

  // Calculate unit price (total price / quantity)
  const totalPrice = raw.price;
  const unitPrice = quantity > 0 ? Math.round(totalPrice / quantity) : totalPrice;

  // Convert Unix timestamp to ISO string
  const timestamp = new Date(raw.time * 1000).toISOString();

  return {
    id: raw.id,
    name: itemName,
    quantity,
    price: totalPrice,
    unitPrice,
    pricetype: raw.pricetype,
    type: isPet ? 'pet' : 'item',
    time: timestamp,
    buyerName: raw.buyname,
  };
}

export interface PriceStats {
  min: number;
  max: number;
  avg: number;
  count: number;
  priceType: number;
}

export interface ChartDataPoint {
  time: string;
  timestamp: number;
  unitPrice: number;
  priceType: number;
  name: string;
}

export function usePriceHistory() {
  const [logs, setLogs] = useState<PriceHistoryLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [stats, setStats] = useState<PriceStats | null>(null);
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);

  // Abort controller for cancelling ongoing fetches
  const abortControllerRef = useRef<AbortController | null>(null);

  const calculateStats = useCallback((allLogs: PriceHistoryLog[]): PriceStats | null => {
    if (allLogs.length === 0) return null;

    const prices = allLogs.map(log => log.price);
    const primaryPriceType = allLogs[0].pricetype;

    return {
      min: Math.min(...prices),
      max: Math.max(...prices),
      avg: prices.reduce((sum, p) => sum + p, 0) / prices.length,
      count: allLogs.length,
      priceType: primaryPriceType,
    };
  }, []);

  const generateChartData = useCallback((allLogs: PriceHistoryLog[]): ChartDataPoint[] => {
    // Sort by time ascending for chart
    const sorted = [...allLogs].sort((a, b) =>
      new Date(a.time).getTime() - new Date(b.time).getTime()
    );

    return sorted.map(log => ({
      time: log.time,
      timestamp: new Date(log.time).getTime(),
      unitPrice: log.unitPrice,
      priceType: log.pricetype,
      name: log.name,
    }));
  }, []);

  const search = useCallback(async (params: Partial<PriceHistorySearchParams>) => {
    // Cancel any ongoing fetch
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    setLoading(true);
    setError(null);
    setProgress(null);
    setLogs([]);
    setStats(null);
    setChartData([]);

    const term = params.search || '';
    if (!term.trim()) {
      setError('Please enter a search term');
      setLoading(false);
      return null;
    }

    const baseParams = {
      search: term,
      type: params.type || 'all',
    };

    try {
      // Fetch first page
      const firstPageParams = new URLSearchParams({ ...baseParams, page: '1' });
      const firstResponse = await fetch(`/api/marketrecord?${firstPageParams.toString()}`, { signal });

      if (!firstResponse.ok) {
        throw new Error('Failed to fetch price history');
      }

      const firstResult: PriceHistoryResponseRaw = await firstResponse.json();
      const totalPages = Math.ceil(firstResult.totalFiltered / firstResult.perPage);
      const pagesToFetch = Math.min(totalPages, MAX_PAGES);

      setProgress({ current: 1, total: pagesToFetch });

      // Collect all logs - parse raw logs
      const allLogs: PriceHistoryLog[] = firstResult.logs.map(parseLog);
      setLogs([...allLogs]);

      // Fetch remaining pages
      for (let page = 2; page <= pagesToFetch; page++) {
        if (signal.aborted) break;

        await delay(FETCH_DELAY);

        if (signal.aborted) break;

        const pageParams = new URLSearchParams({ ...baseParams, page: String(page) });
        const pageResponse = await fetch(`/api/marketrecord?${pageParams.toString()}`, { signal });

        if (!pageResponse.ok) {
          console.warn(`Failed to fetch page ${page}`);
          continue;
        }

        const pageResult: PriceHistoryResponseRaw = await pageResponse.json();
        allLogs.push(...pageResult.logs.map(parseLog));

        // Update UI progressively
        setLogs([...allLogs]);
        setProgress({ current: page, total: pagesToFetch });
      }

      // Calculate stats and chart data
      const calculatedStats = calculateStats(allLogs);
      setStats(calculatedStats);
      setChartData(generateChartData(allLogs));

      setProgress(null);
      return allLogs;
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
  }, [calculateStats, generateChartData]);

  return {
    logs,
    loading,
    error,
    search,
    progress,
    stats,
    chartData,
  };
}
