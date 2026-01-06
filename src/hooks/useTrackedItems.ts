'use client';

import { useState, useEffect, useCallback } from 'react';
import type { TrackedItem, PriceRecord } from '@/types/market';

const STORAGE_KEY = 'market-tracker-items';

export function useTrackedItems() {
  const [trackedItems, setTrackedItems] = useState<TrackedItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        setTrackedItems(JSON.parse(stored));
      } catch (e) {
        console.error('Failed to parse tracked items:', e);
      }
    }
    setLoaded(true);
  }, []);

  // Save to localStorage whenever items change
  useEffect(() => {
    if (loaded) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trackedItems));
    }
  }, [trackedItems, loaded]);

  const addTrackedItem = useCallback((item: Omit<TrackedItem, 'id' | 'createdAt' | 'lastChecked' | 'priceHistory'>) => {
    const newItem: TrackedItem = {
      ...item,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      lastChecked: new Date().toISOString(),
      priceHistory: [],
    };
    setTrackedItems(prev => [...prev, newItem]);
    return newItem;
  }, []);

  const removeTrackedItem = useCallback((id: string) => {
    setTrackedItems(prev => prev.filter(item => item.id !== id));
  }, []);

  const updateTrackedItem = useCallback((id: string, updates: Partial<TrackedItem>) => {
    setTrackedItems(prev =>
      prev.map(item =>
        item.id === id ? { ...item, ...updates } : item
      )
    );
  }, []);

  const addPriceRecord = useCallback((id: string, records: PriceRecord[]) => {
    setTrackedItems(prev =>
      prev.map(item => {
        if (item.id !== id) return item;

        // Keep last 100 records per item
        const newHistory = [...item.priceHistory, ...records].slice(-100);

        return {
          ...item,
          priceHistory: newHistory,
          lastChecked: new Date().toISOString(),
        };
      })
    );
  }, []);

  const getAveragePrice = useCallback((id: string): number | null => {
    const item = trackedItems.find(i => i.id === id);
    if (!item || item.priceHistory.length === 0) return null;

    const sum = item.priceHistory.reduce((acc, record) => acc + record.price, 0);
    return Math.round(sum / item.priceHistory.length);
  }, [trackedItems]);

  const getLowestPrice = useCallback((id: string): number | null => {
    const item = trackedItems.find(i => i.id === id);
    if (!item || item.priceHistory.length === 0) return null;

    return Math.min(...item.priceHistory.map(r => r.price));
  }, [trackedItems]);

  const checkAlerts = useCallback((id: string, currentPrices: number[]): { triggered: boolean; lowestPrice: number; avgPrice: number; threshold: number } | null => {
    const item = trackedItems.find(i => i.id === id);
    if (!item || !item.isActive) return null;

    const avgPrice = getAveragePrice(id);
    if (avgPrice === null || currentPrices.length === 0) return null;

    const lowestCurrentPrice = Math.min(...currentPrices);
    const thresholdPrice = avgPrice * (1 - item.alertThreshold / 100);

    return {
      triggered: lowestCurrentPrice <= thresholdPrice,
      lowestPrice: lowestCurrentPrice,
      avgPrice,
      threshold: item.alertThreshold,
    };
  }, [trackedItems, getAveragePrice]);

  return {
    trackedItems,
    loaded,
    addTrackedItem,
    removeTrackedItem,
    updateTrackedItem,
    addPriceRecord,
    getAveragePrice,
    getLowestPrice,
    checkAlerts,
  };
}
