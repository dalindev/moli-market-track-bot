'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Default: no refetch on window focus (we control manually)
            refetchOnWindowFocus: false,
            // Default: retry once on failure
            retry: 1,
            // Default stale time: 0 (always stale, but cached)
            staleTime: 0,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}

// Query keys for consistent caching
export const queryKeys = {
  // Items list - cache for 30 minutes (names don't change often)
  items: {
    all: ['items'] as const,
    search: (term: string) => ['items', 'search', term] as const,
  },
  // Exchange rate - cache for 5 minutes
  exchangeRate: {
    current: ['exchangeRate', 'current'] as const,
    history: ['exchangeRate', 'history'] as const,
  },
  // Tracked items - NO cache (need fresh data for alerts)
  trackedItems: {
    all: ['trackedItems'] as const,
  },
  // Price history - cache for 10 minutes (historical data)
  priceHistory: {
    byItem: (itemId: string) => ['priceHistory', itemId] as const,
    daily: (itemId: string) => ['priceHistory', 'daily', itemId] as const,
  },
  // Market search - NO cache (need fresh prices)
  market: {
    search: (params: Record<string, unknown>) => ['market', 'search', params] as const,
  },
} as const;

// Cache durations
export const cacheDurations = {
  items: 30 * 60 * 1000,        // 30 minutes
  exchangeRate: 5 * 60 * 1000,  // 5 minutes
  priceHistory: 10 * 60 * 1000, // 10 minutes
  // Market and tracked items: 0 (no cache - always fresh)
} as const;
