'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { Input } from '@/components/ui/input';
import { AutocompleteInput } from '@/components/ui/autocomplete-input';
import { useMarket, FlattenedItem } from '@/hooks/useMarket';
import { useSupabaseItems } from '@/hooks/useSupabaseItems';
import { useExchangeRate } from '@/hooks/useExchangeRate';
import { normalizeSearchInput } from '@/lib/chinese-converter';
import { getLevelSuffix, hasDisplayLevel, getLevelColors, LEVEL_NAMES, isGaiZaoTuLevel } from '@/lib/item-level';
import { toast } from 'sonner';

const SERVER_NAMES: Record<number, string> = {
  1: 'S1',
  2: 'S2',
  3: 'S3',
  4: 'S4',
  5: 'S5',
};

// Currency types: 0 = 金幣 (Gold), 1 = 魔晶 (Crystal)
const CURRENCY_NAMES: Record<number, string> = {
  0: '金幣',
  1: '魔晶',
};

// Convert price to 金幣 equivalent for comparison
function normalizeToGold(price: number, priceType: number, rate: number): number {
  if (priceType === 1) {
    return price * rate;
  }
  return price;
}

// Format large numbers with K suffix
function formatPrice(price: number): string {
  if (price >= 1000000) {
    return (price / 1000000).toFixed(1) + 'M';
  }
  if (price >= 1000) {
    return (price / 1000).toFixed(1) + 'K';
  }
  return price.toString();
}

// Format with currency
function formatPriceWithCurrency(price: number, priceType: number): string {
  const formatted = formatPrice(price);
  const currency = CURRENCY_NAMES[priceType] || '金幣';
  return `${formatted} ${currency}`;
}

// Grouped item type
interface GroupedItem {
  item: FlattenedItem;
  count: number;      // Number of listings grouped together
  quantity: number;   // Total quantity (sum of ITEM_REMAIN for items, count for pets)
  key: string;
  // Durability tracking (for averaging across grouped items)
  totalDurability: number;
  totalMaxDurability: number;
  durabilityCount: number;  // Number of items with durability data
}

// Group items by same name, level (for items), price, server, stall, location
function groupItems(items: FlattenedItem[], rate: number): GroupedItem[] {
  const groups = new Map<string, GroupedItem>();

  for (const item of items) {
    // Include item level in key for non-pets (items with same name but different levels are different)
    const itemLevel = item.isPet ? 0 : (item.itemData?.ITEM_LEVEL ?? 0);
    const key = `${item.name}-${itemLevel}-${item.price}-${item.pricetype}-${item.stall.server}-${item.stall.name}-${item.stall.coords}-${item.isPet}`;

    // Get actual quantity from ITEM_REMAIN for items, default to 1 for pets
    const itemQuantity = item.isPet ? 1 : (item.itemData?.ITEM_REMAIN ?? 1);

    // Get durability data (only for non-pets)
    const durability = item.itemData?.ITEM_DURABILITY ?? 0;
    const maxDurability = item.itemData?.ITEM_MAXDURABILITY ?? 0;
    const hasDurability = !item.isPet && maxDurability > 0;

    if (groups.has(key)) {
      const group = groups.get(key)!;
      group.count++;
      group.quantity += itemQuantity;
      if (hasDurability) {
        group.totalDurability += durability;
        group.totalMaxDurability += maxDurability;
        group.durabilityCount++;
      }
    } else {
      groups.set(key, {
        item,
        count: 1,
        quantity: itemQuantity,
        key,
        totalDurability: hasDurability ? durability : 0,
        totalMaxDurability: hasDurability ? maxDurability : 0,
        durabilityCount: hasDurability ? 1 : 0,
      });
    }
  }

  // Sort by normalized price (金幣 equivalent) ascending
  return Array.from(groups.values()).sort((a, b) => {
    const priceA = normalizeToGold(a.item.price, a.item.pricetype, rate);
    const priceB = normalizeToGold(b.item.price, b.item.pricetype, rate);
    return priceA - priceB;
  });
}

export function MarketSearch() {
  const [searchTerm, setSearchTerm] = useState('');
  const [convertedTerm, setConvertedTerm] = useState('');
  const [isConverted, setIsConverted] = useState(false);
  const [server, setServer] = useState<string>('all');
  const [type, setType] = useState<string>('all');
  const [showOtherItems, setShowOtherItems] = useState(false);
  const { matchingItems, otherItems, loading, loadingMore, error, search, progress, hasMore, loadMore } = useMarket();
  const {
    trackedItems,
    addTrackedItem,
    savePriceSnapshots,
    checkAlert,
    upsertItem,
  } = useSupabaseItems();

  const [trackDialogOpen, setTrackDialogOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<FlattenedItem | null>(null);
  const [alertThreshold, setAlertThreshold] = useState('50');
  const [trackingLoading, setTrackingLoading] = useState(false);

  // Exchange rate from database
  const { currentRate, DEFAULT_GOLD_PER_CRYSTAL } = useExchangeRate();
  const crystalRate = currentRate?.goldPerCrystal ?? DEFAULT_GOLD_PER_CRYSTAL;

  // Saved searches (stored in localStorage)
  interface SavedSearch {
    term: string;
    exact: boolean;
  }
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [saveAsExact, setSaveAsExact] = useState(true); // Default to exact match

  // Load saved searches from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('market-saved-searches-v2');
    if (saved) {
      try {
        setSavedSearches(JSON.parse(saved));
      } catch {
        // Invalid JSON, ignore
      }
    } else {
      // Migrate old format (string[]) to new format
      const oldSaved = localStorage.getItem('market-saved-searches');
      if (oldSaved) {
        try {
          const oldTerms = JSON.parse(oldSaved) as string[];
          const migrated = oldTerms.map(term => ({ term, exact: false }));
          setSavedSearches(migrated);
          localStorage.setItem('market-saved-searches-v2', JSON.stringify(migrated));
          localStorage.removeItem('market-saved-searches');
        } catch {
          // Invalid JSON, ignore
        }
      }
    }
  }, []);

  // Save to localStorage whenever savedSearches changes
  const updateSavedSearches = (searches: SavedSearch[]) => {
    setSavedSearches(searches);
    localStorage.setItem('market-saved-searches-v2', JSON.stringify(searches));
  };

  const addSavedSearch = () => {
    if (!searchTerm.trim()) return;
    const term = searchTerm.trim();
    if (savedSearches.some(s => s.term === term)) {
      toast.info('Search already saved');
      return;
    }
    updateSavedSearches([...savedSearches, { term, exact: saveAsExact }]);
    toast.success(`Saved: ${term} (${saveAsExact ? 'exact' : 'partial'})`);
  };

  const removeSavedSearch = (term: string) => {
    updateSavedSearches(savedSearches.filter(s => s.term !== term));
  };

  const toggleSavedSearchExact = (term: string) => {
    updateSavedSearches(savedSearches.map(s =>
      s.term === term ? { ...s, exact: !s.exact } : s
    ));
  };

  const triggerSavedSearch = (saved: SavedSearch) => {
    setSearchTerm(saved.term);
    // Trigger search after a short delay to let state update
    setTimeout(() => {
      const normalized = normalizeSearchInput(saved.term);
      const searchQuery = normalized.traditional;
      setConvertedTerm(searchQuery);
      setIsConverted(normalized.isConverted);
      search({
        search: searchQuery,
        server: server as 'all' | '1' | '2' | '3' | '4' | '5',
        type: type as 'all' | '道具攤位' | '寵物攤位',
        exact: saved.exact,
        page: 1,
      });
    }, 50);
  };

  // Format with currency and show gold equivalent if crystal
  const formatPriceWithEquivalent = (price: number, priceType: number): string => {
    const formatted = formatPrice(price);
    const currency = CURRENCY_NAMES[priceType] || '金幣';
    if (priceType === 1) {
      const goldEquiv = normalizeToGold(price, priceType, crystalRate);
      return `${formatted} ${currency} (~${formatPrice(goldEquiv)} 金)`;
    }
    return `${formatted} ${currency}`;
  };

  const handleSearch = async () => {
    if (!searchTerm.trim()) {
      toast.error('Please enter a search term');
      return;
    }

    // Convert simplified Chinese to traditional Chinese for search
    const normalized = normalizeSearchInput(searchTerm);
    const searchQuery = normalized.traditional;
    setConvertedTerm(searchQuery);
    setIsConverted(normalized.isConverted);

    if (normalized.isConverted) {
      toast.info(`Searching with Traditional Chinese: ${searchQuery}`, { duration: 3000 });
    }

    const result = await search({
      search: searchQuery,
      server: server as 'all' | '1' | '2' | '3' | '4' | '5',
      type: type as 'all' | '道具攤位' | '寵物攤位',
      exact: false, // Use partial match (includes) for item names
      page: 1,
    });

    if (result) {
      toast.success(`Found ${matchingItems.length} matching items`);

      // Check for alerts on tracked items
      for (const tracked of trackedItems) {
        const matches = matchingItems.filter(
          item => item.name.includes(tracked.itemName)
        );

        if (matches.length > 0) {
          // Find lowest price match
          const lowestMatch = matches.reduce((min, item) =>
            item.price < min.price ? item : min
          );

          const alertResult = checkAlert(tracked, lowestMatch.price, lowestMatch.pricetype);

          if (alertResult?.triggered) {
            toast.warning(
              `ALERT: ${tracked.itemName} is ${alertResult.percentBelow}% below average!\n` +
              `Current: ${formatPrice(alertResult.currentPrice)} | Avg: ${formatPrice(alertResult.averagePrice)}\n` +
              `Location: S${lowestMatch.stall.server} ${lowestMatch.stall.coords}`,
              { duration: 10000 }
            );
          }

          // Save price snapshots to Supabase
          await savePriceSnapshots(
            tracked.itemName,
            matches.map(item => ({
              price: item.price,
              pricetype: item.pricetype,
              server: item.stall.server,
              stall_name: item.stall.name,
              stall_cdkey: item.stall.cdkey,
              coords: item.stall.coords,
              source: 'market' as const,
            }))
          );
        }
      }
    }
  };

  const handleTrackItem = (item: FlattenedItem) => {
    setSelectedItem(item);
    setTrackDialogOpen(true);
  };

  const confirmTrackItem = async () => {
    if (!selectedItem) return;

    const itemLevel = selectedItem.itemData?.ITEM_LEVEL ?? null;
    // Include level suffix for items (not pets) with level >= 5
    const trackingName = selectedItem.isPet
      ? selectedItem.name
      : hasDisplayLevel(itemLevel)
        ? `${selectedItem.name}${getLevelSuffix(itemLevel)}`
        : selectedItem.name;

    const existing = trackedItems.find(
      t => t.itemName === trackingName
    );

    if (existing) {
      toast.error('This item is already being tracked');
      setTrackDialogOpen(false);
      return;
    }

    setTrackingLoading(true);
    try {
      const success = await addTrackedItem(
        trackingName,
        selectedItem.isPet ? 'pet' : 'item',
        selectedItem.itemData?.ITEM_ID,
        selectedItem.itemData?.ITEM_BASEIMAGENUMBER || selectedItem.petData?.BaseImgnum,
        parseInt(alertThreshold) || 50,
        selectedItem.price,
        itemLevel
      );

      if (success) {
        toast.success(`Now tracking: ${trackingName}`);

        // Save initial price snapshot
        await savePriceSnapshots(trackingName, [{
          price: selectedItem.price,
          pricetype: selectedItem.pricetype,
          server: selectedItem.stall.server,
          stall_name: selectedItem.stall.name,
          stall_cdkey: selectedItem.stall.cdkey,
          coords: selectedItem.stall.coords,
          source: 'market' as const,
        }]);
      } else {
        toast.error('Failed to track item. It may already be tracked.');
      }
    } catch (err) {
      toast.error('Error tracking item');
      console.error(err);
    } finally {
      setTrackingLoading(false);
      setTrackDialogOpen(false);
    }
  };

  // Calculate price statistics for matching items only
  const priceStats = matchingItems.length > 0 ? {
    min: Math.min(...matchingItems.map(i => i.price)),
    max: Math.max(...matchingItems.map(i => i.price)),
    avg: matchingItems.reduce((sum, i) => sum + i.price, 0) / matchingItems.length,
    count: matchingItems.length,
  } : null;

  // Group matching items
  const groupedMatchingItems = groupItems(matchingItems, crystalRate);
  const groupedOtherItems = groupItems(otherItems, crystalRate);

  const renderGroupedRow = (grouped: GroupedItem) => {
    const { item, quantity, durabilityCount, totalDurability, totalMaxDurability } = grouped;
    const itemLevel = item.itemData?.ITEM_LEVEL ?? null;
    // For matching tracked items, include level for non-pets
    const trackingKey = item.isPet ? item.name : `${item.name}${getLevelSuffix(itemLevel)}`;
    const isTracked = trackedItems.some(
      t => t.itemName === trackingKey || t.itemName === item.name
    );
    const tracked = trackedItems.find(
      t => t.itemName === trackingKey || t.itemName === item.name
    );
    const refPrice = tracked?.referencePrice ?? null;
    const isBelowAvg = refPrice && item.price < refPrice * 0.5;

    // Calculate average durability for grouped items
    const avgDurability = durabilityCount > 0 ? Math.round(totalDurability / durabilityCount) : null;
    const avgMaxDurability = durabilityCount > 0 ? Math.round(totalMaxDurability / durabilityCount) : null;

    return (
      <TableRow
        key={grouped.key}
        className={isBelowAvg ? 'bg-green-500/10' : ''}
      >
        <TableCell className="font-medium">
          {item.name}
          {/* Show level for all items (not pets) */}
          {!item.isPet && hasDisplayLevel(itemLevel) && (() => {
            // Only 改造圖 items get special names (普通/银/金) and colors
            const isGaiZaoTu = item.name.includes('改造圖') && isGaiZaoTuLevel(itemLevel);
            if (isGaiZaoTu) {
              const colors = getLevelColors(itemLevel);
              return (
                <Badge
                  variant="outline"
                  className={`ml-2 ${colors.text} ${colors.bg} ${colors.border}`}
                >
                  {LEVEL_NAMES[itemLevel!]}
                </Badge>
              );
            }
            // All other items just show "Lv{x}" with neutral styling
            return (
              <Badge variant="secondary" className="ml-2">
                Lv{itemLevel}
              </Badge>
            );
          })()}
          {item.isPet && (
            <>
              <Badge variant="outline" className="ml-2 text-purple-600">
                Pet
              </Badge>
              {item.petData?.Lv && (
                <Badge variant="secondary" className="ml-1">
                  Lv{item.petData.Lv}
                </Badge>
              )}
            </>
          )}
          {isTracked && (
            <Badge variant="outline" className="ml-2">
              Tracked
            </Badge>
          )}
        </TableCell>
        <TableCell className="text-center">
          {quantity}
        </TableCell>
        <TableCell>
          <span className={isBelowAvg ? 'text-green-600 font-bold' : ''}>
            {formatPriceWithEquivalent(item.price, item.pricetype)}
          </span>
          {refPrice && (
            <span className="text-muted-foreground text-xs ml-2">
              (ref: {formatPrice(refPrice)})
            </span>
          )}
        </TableCell>
        <TableCell>
          {avgDurability !== null && avgMaxDurability !== null && avgMaxDurability > 0 ? (() => {
            const percentage = Math.round((avgDurability / avgMaxDurability) * 100);
            const isFull = percentage === 100;

            if (isFull) {
              // Full durability - green, no percentage shown
              return (
                <span className="text-green-600">
                  {avgDurability}/{avgMaxDurability}
                </span>
              );
            }

            // Damaged - red with percentage
            return (
              <span className="text-red-500">
                {avgDurability}/{avgMaxDurability}
                <span className="text-xs ml-1 opacity-75">({percentage}%)</span>
              </span>
            );
          })() : (
            <span className="text-muted-foreground">-</span>
          )}
        </TableCell>
        <TableCell>
          <Badge variant="outline">
            {SERVER_NAMES[item.stall.server] || `S${item.stall.server}`}
          </Badge>
        </TableCell>
        <TableCell>{item.stall.name}</TableCell>
        <TableCell className="text-sm text-muted-foreground">
          {item.stall.coords}
        </TableCell>
        <TableCell>
          {!isTracked && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleTrackItem(item)}
            >
              Track
            </Button>
          )}
        </TableCell>
      </TableRow>
    );
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Market Search</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            <div className="flex-1 min-w-[200px]">
              <AutocompleteInput
                value={searchTerm}
                onChange={setSearchTerm}
                onSelect={(itemName) => {
                  setSearchTerm(itemName);
                }}
                onEnter={handleSearch}
                placeholder="Search items... (支持简体/繁體)"
              />
              {isConverted && convertedTerm && (
                <span className="text-xs text-muted-foreground mt-1 block">
                  → Searching: {convertedTerm}
                </span>
              )}
            </div>
            <Select value={server} onValueChange={setServer}>
              <SelectTrigger className="w-[120px]">
                <SelectValue placeholder="Server" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Servers</SelectItem>
                <SelectItem value="1">S1</SelectItem>
                <SelectItem value="2">S2</SelectItem>
                <SelectItem value="3">S3</SelectItem>
                <SelectItem value="4">S4</SelectItem>
                <SelectItem value="5">S5</SelectItem>
              </SelectContent>
            </Select>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="道具攤位">Items</SelectItem>
                <SelectItem value="寵物攤位">Pets</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={handleSearch} disabled={loading}>
              {loading ? 'Searching...' : 'Search'}
            </Button>
            <Button
              variant="outline"
              onClick={addSavedSearch}
              disabled={!searchTerm.trim()}
              title="Save this search for quick access"
            >
              ⭐ Save
            </Button>
            <Button
              variant={saveAsExact ? 'default' : 'ghost'}
              size="icon"
              onClick={() => setSaveAsExact(!saveAsExact)}
              className="h-10 w-10"
              title={saveAsExact ? 'Will save as exact match' : 'Will save as partial match'}
            >
              {saveAsExact ? '=' : '≈'}
            </Button>
          </div>

          {/* Saved Searches */}
          {savedSearches.length > 0 && (
            <div className="mt-4 pt-4 border-t">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm text-muted-foreground">Quick search:</span>
                {savedSearches.map((saved) => (
                  <div key={saved.term} className="inline-flex items-center gap-0.5 group">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => triggerSavedSearch(saved)}
                      disabled={loading}
                      className="h-7 px-2 text-sm"
                    >
                      <span
                        className={`mr-1 text-xs ${saved.exact ? 'text-green-600' : 'text-orange-500'}`}
                        title={saved.exact ? 'Exact match' : 'Partial match'}
                      >
                        {saved.exact ? '=' : '≈'}
                      </span>
                      {saved.term}
                    </Button>
                    <button
                      onClick={() => toggleSavedSearchExact(saved.term)}
                      className="text-muted-foreground hover:text-blue-500 px-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                      title={`Switch to ${saved.exact ? 'partial' : 'exact'} match`}
                    >
                      ⇄
                    </button>
                    <button
                      onClick={() => removeSavedSearch(saved.term)}
                      className="text-muted-foreground hover:text-red-500 px-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Remove saved search"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {error && (
        <Card className="border-red-500">
          <CardContent className="pt-4">
            <p className="text-red-500">Error: {error}</p>
          </CardContent>
        </Card>
      )}

      {priceStats && (
        <Card>
          <CardContent className="pt-4">
            <div className="flex flex-wrap gap-4 items-center">
              <Badge variant="outline" className="text-sm">
                Matches: {priceStats.count}
              </Badge>
              <Badge variant="secondary" className="text-sm">
                Min: {formatPrice(priceStats.min)}
              </Badge>
              <Badge variant="secondary" className="text-sm">
                Avg: {formatPrice(priceStats.avg)}
              </Badge>
              <Badge variant="secondary" className="text-sm">
                Max: {formatPrice(priceStats.max)}
              </Badge>
              {otherItems.length > 0 && (
                <Badge variant="outline" className="text-sm text-muted-foreground">
                  +{otherItems.length} other items in stalls
                </Badge>
              )}
              {progress && (
                <Badge variant="outline" className="text-sm">
                  Loading page {progress.current}/{progress.total}...
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {matchingItems.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              Matching Items ({matchingItems.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-center">Qty</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>耐久</TableHead>
                  <TableHead>Server</TableHead>
                  <TableHead>Stall</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groupedMatchingItems.map((grouped) => renderGroupedRow(grouped))}
              </TableBody>
            </Table>
            {hasMore && (
              <div className="mt-4 flex justify-center">
                <Button
                  variant="outline"
                  onClick={loadMore}
                  disabled={loadingMore}
                >
                  {loadingMore ? 'Loading more...' : 'Load More Pages'}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {otherItems.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg text-muted-foreground">
                Other Items in Stalls ({otherItems.length})
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowOtherItems(!showOtherItems)}
              >
                {showOtherItems ? 'Hide' : 'Show'}
              </Button>
            </div>
          </CardHeader>
          {showOtherItems && (
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-center">Qty</TableHead>
                    <TableHead>Price</TableHead>
                    <TableHead>耐久</TableHead>
                    <TableHead>Server</TableHead>
                    <TableHead>Stall</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groupedOtherItems.map((grouped) => renderGroupedRow(grouped))}
                </TableBody>
              </Table>
            </CardContent>
          )}
        </Card>
      )}

      <Dialog open={trackDialogOpen} onOpenChange={setTrackDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Track Item Price</DialogTitle>
            <DialogDescription>
              Set up price alerts for {selectedItem?.name}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="text-sm font-medium">Current Price</label>
              <p className="text-2xl font-bold">
                {selectedItem && formatPriceWithCurrency(selectedItem.price, selectedItem.pricetype)}
              </p>
            </div>
            <div>
              <label className="text-sm font-medium">
                Alert when price is below average by (%)
              </label>
              <Input
                type="number"
                value={alertThreshold}
                onChange={(e) => setAlertThreshold(e.target.value)}
                min="1"
                max="90"
                className="mt-1"
              />
              <p className="text-sm text-muted-foreground mt-1">
                You will be alerted when the price drops {alertThreshold}% below
                the recorded average
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTrackDialogOpen(false)} disabled={trackingLoading}>
              Cancel
            </Button>
            <Button onClick={confirmTrackItem} disabled={trackingLoading}>
              {trackingLoading ? 'Tracking...' : 'Start Tracking'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
