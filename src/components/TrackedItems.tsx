'use client';

import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useSupabaseItems, TrackedItemDisplay, RecentListing } from '@/hooks/useSupabaseItems';
import { useExchangeRate } from '@/hooks/useExchangeRate';
import { Copy } from 'lucide-react';
import { useMarket } from '@/hooks/useMarket';
import { TimeAgo } from '@/components/TimeAgo';
import { toast } from 'sonner';

// Format large numbers with K suffix
function formatPrice(price: number | null): string {
  if (price === null) return '-';
  if (price >= 1000000) {
    return (price / 1000000).toFixed(1) + 'M';
  }
  if (price >= 1000) {
    return (price / 1000).toFixed(1) + 'K';
  }
  return price.toLocaleString();
}

// Copy text to clipboard
function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text);
  toast.success('Copied to clipboard');
}

// Listing card component for displaying price info
function ListingCard({ listing, rank, exchangeRate }: { listing: RecentListing; rank: number; exchangeRate: number }) {
  const percentBadge = listing.percentBelowAvg !== null && listing.percentBelowAvg > 0;
  const isCrystal = listing.pricetype === 1;

  // Calculate equivalent price in the other currency
  const goldEquivalent = isCrystal ? listing.price * exchangeRate : listing.price;
  const crystalEquivalent = isCrystal ? listing.price : Math.round(listing.price / exchangeRate);

  return (
    <div className="p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          {/* Server badge + Quantity + Discount */}
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <Badge variant="outline" className="text-xs shrink-0">
              S{listing.server}
            </Badge>
            {listing.quantity > 1 && (
              <Badge variant="secondary" className="text-xs shrink-0">
                x{listing.quantity}
              </Badge>
            )}
            {percentBadge && (
              <Badge variant="default" className="text-xs bg-green-600 shrink-0">
                -{listing.percentBelowAvg}%
              </Badge>
            )}
          </div>

          {/* Price display with both currencies */}
          <div className="space-y-0.5 mb-1.5">
            {/* Primary price (listing currency) */}
            <div className="flex items-center gap-1.5">
              {isCrystal ? (
                <>
                  <span className="text-base">💎</span>
                  <span className="font-bold text-blue-600">{formatPrice(listing.price)}</span>
                </>
              ) : (
                <>
                  <span className="text-base">🪙</span>
                  <span className="font-bold text-yellow-600">{formatPrice(listing.price)}</span>
                </>
              )}
            </div>
            {/* Secondary price (equivalent) */}
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {isCrystal ? (
                <>
                  <span>≈ 🪙</span>
                  <span className="text-yellow-600/70">{formatPrice(goldEquivalent)}</span>
                </>
              ) : (
                <>
                  <span>≈ 💎</span>
                  <span className="text-blue-600/70">{formatPrice(crystalEquivalent)}</span>
                </>
              )}
            </div>
          </div>

          {/* Stall name */}
          <p className="text-xs text-muted-foreground truncate" title={listing.stallName}>
            {listing.stallName}
          </p>

          {/* Coords with copy button */}
          <div className="flex items-center gap-1 mt-1">
            <span className="text-xs font-mono text-muted-foreground">{listing.coords}</span>
            <button
              onClick={() => copyToClipboard(listing.coords)}
              className="p-0.5 hover:bg-accent rounded"
              title="Copy coordinates"
            >
              <Copy className="h-3 w-3 text-muted-foreground" />
            </button>
          </div>
        </div>

        {/* Rank indicator */}
        <div className={`text-lg font-bold ${
          rank === 1 ? 'text-yellow-500' : rank === 2 ? 'text-zinc-400' : 'text-amber-700'
        }`}>
          #{rank}
        </div>
      </div>
    </div>
  );
}

export function TrackedItems() {
  const { search } = useMarket();
  const { currentRate, DEFAULT_GOLD_PER_CRYSTAL } = useExchangeRate();
  const exchangeRate = currentRate?.goldPerCrystal ?? DEFAULT_GOLD_PER_CRYSTAL;
  const {
    trackedItems,
    loading,
    error,
    removeTrackedItem,
    updateTrackedItem,
    savePriceSnapshots,
    saveTransactionSnapshots,
    checkAlert,
    fetchTrackedItems,
    updateLastChecked,
  } = useSupabaseItems(exchangeRate);

  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [refreshProgress, setRefreshProgress] = useState<{ current: number; total: number } | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editItem, setEditItem] = useState<{
    id: string;
    threshold: string;
    priceOverride: string;
    medianPrice: number | null;
  } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Helper to extract base name without level suffix
  const getBaseName = (name: string): string => {
    // Remove level suffix like " (金)", " (银)", " (普通)"
    return name.replace(/\s*\((金|银|普通|Lv\d+)\)$/, '');
  };

  // Helper to parse level from item name suffix (fallback for old tracked items without item_level)
  const getLevelFromName = (name: string): number | null => {
    const match = name.match(/\((金|银|普通)\)$/);
    if (!match) return null;
    switch (match[1]) {
      case '金': return 7;
      case '银': return 6;
      case '普通': return 5;
      default: return null;
    }
  };

  // Fetch transaction history for an item (exact name match)
  const fetchTransactionHistory = async (
    itemName: string
  ): Promise<Array<{
    transactionId: number;
    price: number;
    pricetype: number;
    quantity: number;
    buyerName: string;
    recordedAt: string;
  }>> => {
    const MAX_TXN_PAGES = 3;
    const DELAY_MS = 500;
    const results: Array<{
      transactionId: number;
      price: number;
      pricetype: number;
      quantity: number;
      buyerName: string;
      recordedAt: string;
    }> = [];

    for (let page = 1; page <= MAX_TXN_PAGES; page++) {
      try {
        const params = new URLSearchParams({
          search: itemName,
          type: 'all',
          page: String(page),
        });
        const response = await fetch(`/api/marketrecord?${params.toString()}`);
        if (!response.ok) break;

        const data = await response.json();

        for (const log of data.logs || []) {
          // Parse buff format: "購買1個：ItemName" or "購買1隻：PetName"
          const buff: string = log.buff || '';
          const colonIndex = buff.indexOf('：');
          const parsedName = colonIndex !== -1 ? buff.substring(colonIndex + 1).trim() : buff;

          // Exact match only
          if (parsedName !== itemName) continue;

          const quantityMatch = buff.match(/購買(\d+)/);
          const quantity = quantityMatch ? parseInt(quantityMatch[1], 10) : 1;
          const unitPrice = quantity > 0 ? Math.round(log.price / quantity) : log.price;

          results.push({
            transactionId: log.id,
            price: unitPrice,
            pricetype: log.pricetype,
            quantity,
            buyerName: log.buyname || 'Unknown',
            recordedAt: new Date(log.time * 1000).toISOString(),
          });
        }

        // Check if more pages
        const totalPages = Math.ceil(data.totalFiltered / data.perPage);
        if (page >= totalPages) break;

        if (page < MAX_TXN_PAGES) {
          await new Promise(resolve => setTimeout(resolve, DELAY_MS));
        }
      } catch (err) {
        console.error(`Error fetching transactions page ${page}:`, err);
        break;
      }
    }

    return results;
  };

  const refreshPrices = async (tracked: TrackedItemDisplay): Promise<boolean> => {
    setRefreshingId(tracked.id);

    try {
      // Get base name without level suffix for API search
      const baseName = getBaseName(tracked.itemName);
      // Get target level for filtering (e.g., 6 for 银, 7 for 金)
      // Use stored itemLevel, or parse from name suffix as fallback for old tracked items
      const targetLevel = tracked.itemLevel ?? getLevelFromName(tracked.itemName);

      // Fetch up to 3 pages to get more complete data
      const MAX_PAGES = 3;
      const DELAY_MS = 500;

      // Get all items from the response
      const allItems: {
        price: number;
        pricetype: number;
        server: number;
        stall_name: string;
        stall_cdkey: string;
        coords: string;
        quantity: number;
      }[] = [];

      // Helper to process a page result
      const processPage = (result: Awaited<ReturnType<typeof search>>) => {
        if (!result) return;

        for (const [cdkey, items] of Object.entries(result.itemsByCd)) {
          const stall = result.stalls.find(s => s.cdkey === cdkey);
          if (!stall) continue;

          for (const item of items) {
            // EXACT match - item name must equal base name exactly
            // Also filter by level if tracked item has a level (e.g., 改造圖 with specific level)
            const nameMatches = item.ITEM_TRUENAME === baseName;
            const levelMatches = targetLevel === null || item.ITEM_LEVEL === targetLevel;

            if (nameMatches && levelMatches) {
              const sameItems = items.filter(i =>
                i.ITEM_TRUENAME === item.ITEM_TRUENAME &&
                i.ITEM_LEVEL === item.ITEM_LEVEL &&
                i.price === item.price &&
                i.pricetype === item.pricetype
              );
              if (!allItems.some(a =>
                a.stall_cdkey === cdkey &&
                a.price === item.price &&
                a.pricetype === item.pricetype
              )) {
                allItems.push({
                  price: item.price,
                  pricetype: item.pricetype,
                  server: stall.server,
                  stall_name: stall.name,
                  stall_cdkey: cdkey,
                  coords: stall.coords,
                  quantity: sameItems.length,
                });
              }
            }
          }
        }

        // Also check pets (pets don't have levels, just match by name)
        for (const [cdkey, pets] of Object.entries(result.petsByCd || {})) {
          const stall = result.stalls.find(s => s.cdkey === cdkey);
          if (!stall) continue;

          for (const pet of pets) {
            if (pet.Name === baseName) {
              const samePets = pets.filter(p =>
                p.Name === pet.Name &&
                p.price === pet.price &&
                p.pricetype === pet.pricetype
              );
              if (!allItems.some(a =>
                a.stall_cdkey === cdkey &&
                a.price === pet.price &&
                a.pricetype === pet.pricetype
              )) {
                allItems.push({
                  price: pet.price,
                  pricetype: pet.pricetype,
                  server: stall.server,
                  stall_name: stall.name,
                  stall_cdkey: cdkey,
                  coords: stall.coords,
                  quantity: samePets.length,
                });
              }
            }
          }
        }
      };

      // Fetch first page
      const firstResult = await search({ search: baseName, page: 1, exact: true });
      if (!firstResult) {
        toast.error('Failed to fetch prices');
        return false;
      }

      processPage(firstResult);

      // Calculate total pages and fetch more if needed
      const totalPages = Math.ceil(firstResult.totalFiltered / firstResult.perPage);
      const pagesToFetch = Math.min(totalPages, MAX_PAGES);

      for (let page = 2; page <= pagesToFetch; page++) {
        await new Promise(resolve => setTimeout(resolve, DELAY_MS));
        const pageResult = await search({ search: baseName, page, exact: true });
        processPage(pageResult);
      }

      // Save market listings to Supabase - clear old ones first to remove sold items
      if (allItems.length > 0) {
        const result = await savePriceSnapshots(
          tracked.itemName,
          allItems.map(item => ({
            ...item,
            source: 'market' as const,
          })),
          true // clearOldMarketListings - removes stale data
        );

        if (!result.success) {
          toast.error('Failed to save market data');
        }
      }

      // Also fetch transaction history for better reference price calculation
      const transactions = await fetchTransactionHistory(baseName);
      let txnInserted = 0;
      if (transactions.length > 0 && tracked.itemUuid) {
        const txnResult = await saveTransactionSnapshots(tracked.itemUuid, transactions);
        txnInserted = txnResult.inserted;
      }

      // Check alerts against current market listings
      if (allItems.length > 0) {
        // Find lowest gold-equivalent price for alert check
        const lowestItem = allItems.reduce((min, item) => {
          const minGold = min.pricetype === 1 ? min.price * exchangeRate : min.price;
          const itemGold = item.pricetype === 1 ? item.price * exchangeRate : item.price;
          return itemGold < minGold ? item : min;
        });

        const alertResult = checkAlert(tracked, lowestItem.price, lowestItem.pricetype);

        if (alertResult?.currencyMismatch) {
          const expectedCrystal = tracked.referencePrice ? Math.round(tracked.referencePrice / exchangeRate) : '?';
          toast.error(
            `CURRENCY MISMATCH: ${tracked.itemName} listed for ${formatPrice(lowestItem.price)} gold!\n` +
            `Expected ~${formatPrice(Number(expectedCrystal))} crystal = ${formatPrice(tracked.referencePrice ?? 0)} gold\n` +
            `Location: S${lowestItem.server} ${lowestItem.coords}`,
            { duration: 15000 }
          );
        } else if (alertResult?.triggered) {
          toast.warning(
            `ALERT: ${tracked.itemName} is ${alertResult.percentBelow}% below reference!\n` +
            `Current: ${formatPrice(alertResult.currentPrice)} | Ref: ${formatPrice(alertResult.averagePrice)}\n` +
            `Location: S${lowestItem.server} ${lowestItem.coords}`,
            { duration: 10000 }
          );
        } else {
          // Show summary
          const parts: string[] = [];
          if (allItems.length > 0) parts.push(`${allItems.length} listings`);
          if (txnInserted > 0) parts.push(`${txnInserted} new transactions`);
          if (transactions.length > 0 && txnInserted === 0) parts.push(`${transactions.length} transactions (all known)`);
          toast.success(`${tracked.itemName}: ${parts.join(', ')}`);
        }
      } else if (transactions.length > 0) {
        toast.success(`${tracked.itemName}: no listings, ${txnInserted > 0 ? `${txnInserted} new transactions` : `${transactions.length} transactions (all known)`}`);
      } else {
        toast.info(`No listings or transactions found for ${tracked.itemName}`);
      }

      // Update last checked
      await updateLastChecked(tracked.id);
      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      toast.error(`Error refreshing prices: ${errorMessage}`);
      console.error('Refresh error:', err);
      return false;
    } finally {
      setRefreshingId(null);
    }
  };

  // Refresh all tracked items sequentially with delay
  const refreshAll = async () => {
    const activeItems = trackedItems.filter(item => item.isActive);
    if (activeItems.length === 0) {
      toast.info('No active tracked items to refresh');
      return;
    }

    setRefreshingAll(true);
    setRefreshProgress({ current: 0, total: activeItems.length });

    let successCount = 0;
    for (let i = 0; i < activeItems.length; i++) {
      setRefreshProgress({ current: i + 1, total: activeItems.length });
      const success = await refreshPrices(activeItems[i]);
      if (success) successCount++;

      // Delay between items (1 second) to avoid API spam
      if (i < activeItems.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // Refresh the list once at the end
    await fetchTrackedItems();

    setRefreshingAll(false);
    setRefreshProgress(null);
    toast.success(`Refreshed ${successCount}/${activeItems.length} items`);
  };

  // Auto-refresh on component mount (like Search Market's live behavior)
  const hasAutoRefreshed = useRef(false);
  useEffect(() => {
    // Only auto-refresh once per mount, and only if we have items and not already refreshing
    if (!loading && trackedItems.length > 0 && !hasAutoRefreshed.current && !refreshingAll) {
      const activeItems = trackedItems.filter(item => item.isActive);
      if (activeItems.length > 0) {
        hasAutoRefreshed.current = true;
        // Start auto-refresh after a short delay to let UI render first
        const timer = setTimeout(() => {
          refreshAll();
        }, 500);
        return () => clearTimeout(timer);
      }
    }
  }, [loading, trackedItems.length]); // Only depend on loading and item count

  const handleDelete = (id: string) => {
    setItemToDelete(id);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (itemToDelete) {
      setDeletingId(itemToDelete);
      const success = await removeTrackedItem(itemToDelete);
      if (success) {
        toast.success('Item removed from tracking');
      } else {
        toast.error('Failed to remove item');
      }
      setDeletingId(null);
    }
    setDeleteDialogOpen(false);
    setItemToDelete(null);
  };

  const handleEdit = (item: TrackedItemDisplay) => {
    setEditItem({
      id: item.id,
      threshold: String(item.alertThreshold),
      priceOverride: item.priceOverride ? String(item.priceOverride) : '',
      medianPrice: item.medianPriceGold,
    });
    setEditDialogOpen(true);
  };

  const confirmEdit = async () => {
    if (editItem) {
      const priceOverride = editItem.priceOverride.trim()
        ? parseInt(editItem.priceOverride)
        : null;

      const success = await updateTrackedItem(editItem.id, {
        alertThreshold: parseInt(editItem.threshold) || 50,
        priceOverride,
      });
      if (success) {
        toast.success('Settings updated');
      } else {
        toast.error('Failed to update settings');
      }
    }
    setEditDialogOpen(false);
    setEditItem(null);
  };

  const toggleActive = async (id: string, currentlyActive: boolean) => {
    const success = await updateTrackedItem(id, { isActive: !currentlyActive });
    if (success) {
      toast.success(`Tracking ${!currentlyActive ? 'enabled' : 'disabled'}`);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="pt-4">
          <p>Loading tracked items...</p>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-red-500">
        <CardContent className="pt-4">
          <p className="text-red-500">Error: {error}</p>
          <Button onClick={fetchTrackedItems} className="mt-2">
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (trackedItems.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Tracked Items</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            No items being tracked yet. Search for items and click &quot;Track&quot; to add them.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Tracked Items ({trackedItems.length})</CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={refreshAll}
              disabled={refreshingAll || refreshingId !== null}
            >
              {refreshingAll
                ? `Refreshing ${refreshProgress?.current}/${refreshProgress?.total}...`
                : 'Refresh All'}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Alert Threshold</TableHead>
                <TableHead>Price Range (7d)</TableHead>
                <TableHead>Records</TableHead>
                <TableHead>Last Checked</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {trackedItems.map((item) => {
                const alertPrice = item.referencePrice
                  ? Math.round(item.referencePrice * (1 - item.alertThreshold / 100))
                  : null;

                return (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.itemName}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className="cursor-pointer"
                        onClick={() => handleEdit(item)}
                      >
                        {item.alertThreshold}% below ref
                      </Badge>
                      {alertPrice && (
                        <span className="text-xs text-muted-foreground ml-2">
                          (&lt; 🪙{formatPrice(alertPrice)} / 💎{formatPrice(Math.round(alertPrice / exchangeRate))})
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {item.minPrice7d || item.maxPrice7d || item.medianPriceGold ? (
                        <div className="space-y-1">
                          {/* Visual bar showing median position */}
                          {item.minPrice7d && item.maxPrice7d && item.medianPriceGold && item.maxPrice7d > item.minPrice7d && (
                            <div className="relative h-2 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden w-32">
                              {/* Median position marker */}
                              {(() => {
                                const range = item.maxPrice7d - item.minPrice7d;
                                const medianPos = ((item.medianPriceGold - item.minPrice7d) / range) * 100;
                                const clampedPos = Math.max(5, Math.min(95, medianPos));
                                return (
                                  <div
                                    className="absolute top-0 h-full w-1.5 bg-amber-500 rounded-full transform -translate-x-1/2"
                                    style={{ left: `${clampedPos}%` }}
                                    title={`Median at ${Math.round(medianPos)}% of range`}
                                  />
                                );
                              })()}
                              {/* Gradient from green (low) to red (high) */}
                              <div className="absolute inset-0 bg-gradient-to-r from-green-400 via-yellow-400 to-red-400 opacity-30" />
                            </div>
                          )}
                          {/* Price values in gold: Min / Median / Max */}
                          <div className="flex items-center gap-1 text-sm">
                            <span className="text-base">🪙</span>
                            <span className="text-green-600 font-medium" title="7-day minimum (gold)">
                              {formatPrice(item.minPrice7d)}
                            </span>
                            <span className="text-muted-foreground">/</span>
                            <span
                              className={`font-bold cursor-pointer hover:underline ${item.priceOverride ? 'text-blue-600' : 'text-amber-600'}`}
                              onClick={() => handleEdit(item)}
                              title={item.priceOverride ? `Override: ${formatPrice(item.priceOverride)} (click to edit)` : 'Trimmed median (click to override)'}
                            >
                              {formatPrice(item.medianPriceGold)}
                              {item.priceOverride && <span className="text-xs">*</span>}
                            </span>
                            <span className="text-muted-foreground">/</span>
                            <span className="text-red-600 font-medium" title="7-day maximum (gold)">
                              {formatPrice(item.maxPrice7d)}
                            </span>
                          </div>
                          {/* Crystal equivalent row */}
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <span className="text-base">💎</span>
                            <span className="text-green-600/70">
                              {formatPrice(item.minPrice7d ? Math.round(item.minPrice7d / exchangeRate) : null)}
                            </span>
                            <span>/</span>
                            <span className={item.priceOverride ? 'text-blue-600/70 font-medium' : 'text-amber-600/70 font-medium'}>
                              {formatPrice(item.medianPriceGold ? Math.round(item.medianPriceGold / exchangeRate) : null)}
                            </span>
                            <span>/</span>
                            <span className="text-red-600/70">
                              {formatPrice(item.maxPrice7d ? Math.round(item.maxPrice7d / exchangeRate) : null)}
                            </span>
                          </div>
                          {/* Override indicator if different from median */}
                          {item.priceOverride && item.priceOverride !== item.medianPriceGold && (
                            <div className="text-xs text-blue-600">
                              Alert ref: {formatPrice(item.priceOverride)}* (💎 {formatPrice(Math.round(item.priceOverride / exchangeRate))})
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">No data yet</span>
                      )}
                    </TableCell>
                    <TableCell>{item.transactionCount7d ?? '-'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      <TimeAgo date={item.lastChecked} />
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={item.isActive ? 'default' : 'secondary'}
                        className="cursor-pointer"
                        onClick={() => toggleActive(item.id, item.isActive)}
                      >
                        {item.isActive ? 'Active' : 'Paused'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={refreshingId === item.id}
                          onClick={() => refreshPrices(item)}
                        >
                          {refreshingId === item.id ? 'Refreshing...' : 'Refresh'}
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={deletingId === item.id}
                          onClick={() => handleDelete(item.id)}
                        >
                          {deletingId === item.id ? 'Removing...' : 'Remove'}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Best Prices Card - Top 3 lowest for each item */}
      {trackedItems.some(item => item.recentListings.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Current Market Listings</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {trackedItems
                .filter(item => item.recentListings.length > 0)
                .map(item => (
                  <div key={`listings-${item.id}`} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <h4 className="font-medium">{item.itemName}</h4>
                      {item.referencePrice && (
                        <span className="text-xs text-muted-foreground">
                          Ref: {formatPrice(item.referencePrice)}
                          {item.priceOverride && ' *'}
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-1.5">
                      {item.recentListings.map((listing, idx) => (
                        <ListingCard key={idx} listing={listing} rank={idx + 1} exchangeRate={exchangeRate} />
                      ))}
                    </div>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Tracked Item</DialogTitle>
            <DialogDescription>
              Are you sure you want to stop tracking this item? Price history in the database will be preserved.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete}>
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Settings Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Item Settings</DialogTitle>
            <DialogDescription>
              Configure alert threshold and reference price override
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            {/* Alert Threshold */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Alert Threshold (%)</label>
              <Input
                type="number"
                value={editItem?.threshold || ''}
                onChange={(e) =>
                  setEditItem((prev) =>
                    prev ? { ...prev, threshold: e.target.value } : null
                  )
                }
                min="1"
                max="90"
              />
              <p className="text-xs text-muted-foreground">
                Alert when price is {editItem?.threshold || 50}% below reference price
              </p>
            </div>

            {/* Price Override */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Reference Price Override (Gold)</label>
              <Input
                type="number"
                value={editItem?.priceOverride || ''}
                placeholder={editItem?.medianPrice ? `Median: ${formatPrice(editItem.medianPrice)}` : 'Enter custom price'}
                onChange={(e) =>
                  setEditItem((prev) =>
                    prev ? { ...prev, priceOverride: e.target.value } : null
                  )
                }
                min="0"
              />
              <p className="text-xs text-muted-foreground">
                {editItem?.medianPrice
                  ? `Leave empty to use calculated median (${formatPrice(editItem.medianPrice)})`
                  : 'Set a custom reference price for % calculations'}
              </p>
              {editItem?.priceOverride && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs h-6 px-2"
                  onClick={() => setEditItem(prev => prev ? { ...prev, priceOverride: '' } : null)}
                >
                  Clear override (use median)
                </Button>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={confirmEdit}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
