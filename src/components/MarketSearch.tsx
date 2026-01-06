'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
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
import { useMarket, FlattenedItem } from '@/hooks/useMarket';
import { useTrackedItems } from '@/hooks/useTrackedItems';
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

export function MarketSearch() {
  const [searchTerm, setSearchTerm] = useState('');
  const [server, setServer] = useState<string>('all');
  const [type, setType] = useState<string>('all');
  const [showOtherItems, setShowOtherItems] = useState(false);
  const { matchingItems, otherItems, loading, error, search } = useMarket();
  const { trackedItems, addTrackedItem, addPriceRecord, checkAlerts, getAveragePrice } = useTrackedItems();

  const [trackDialogOpen, setTrackDialogOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<FlattenedItem | null>(null);
  const [alertThreshold, setAlertThreshold] = useState('50');

  const handleSearch = async () => {
    if (!searchTerm.trim()) {
      toast.error('Please enter a search term');
      return;
    }

    const result = await search({
      search: searchTerm,
      server: server as 'all' | '1' | '2' | '3' | '4' | '5',
      type: type as 'all' | '道具攤位' | '寵物攤位',
      exact: false,
      page: 1,
    });

    if (result) {
      toast.success(`Found ${matchingItems.length} matching items`);

      // Check for alerts on tracked items
      trackedItems.forEach(tracked => {
        const matches = matchingItems.filter(
          item => item.ITEM_TRUENAME.includes(tracked.itemName) ||
                  item.ITEM_ID === tracked.itemId
        );

        if (matches.length > 0) {
          const prices = matches.map(i => i.price);
          const alertResult = checkAlerts(tracked.id, prices);

          if (alertResult?.triggered) {
            toast.warning(
              `ALERT: ${tracked.itemName} is ${alertResult.threshold}% below average! Current: ${alertResult.lowestPrice}, Avg: ${alertResult.avgPrice}`,
              { duration: 10000 }
            );
          }

          // Record prices
          addPriceRecord(
            tracked.id,
            matches.map(item => ({
              price: item.price,
              server: item.stall.server,
              stallName: item.stall.name,
              coords: item.stall.coords,
              timestamp: new Date().toISOString(),
            }))
          );
        }
      });
    }
  };

  const handleTrackItem = (item: FlattenedItem) => {
    setSelectedItem(item);
    setTrackDialogOpen(true);
  };

  const confirmTrackItem = () => {
    if (!selectedItem) return;

    const existing = trackedItems.find(
      t => t.itemName === selectedItem.ITEM_TRUENAME
    );

    if (existing) {
      toast.error('This item is already being tracked');
      setTrackDialogOpen(false);
      return;
    }

    addTrackedItem({
      itemName: selectedItem.ITEM_TRUENAME,
      itemId: selectedItem.ITEM_ID,
      targetPrice: selectedItem.price,
      alertThreshold: parseInt(alertThreshold) || 50,
      isActive: true,
    });

    toast.success(`Now tracking: ${selectedItem.ITEM_TRUENAME}`);
    setTrackDialogOpen(false);
  };

  // Calculate price statistics for matching items only
  const priceStats = matchingItems.length > 0 ? {
    min: Math.min(...matchingItems.map(i => i.price)),
    max: Math.max(...matchingItems.map(i => i.price)),
    avg: matchingItems.reduce((sum, i) => sum + i.price, 0) / matchingItems.length,
    count: matchingItems.length,
  } : null;

  const renderItemRow = (item: FlattenedItem, index: number) => {
    const isTracked = trackedItems.some(
      t => t.itemName === item.ITEM_TRUENAME
    );
    const tracked = trackedItems.find(
      t => t.itemName === item.ITEM_TRUENAME
    );
    const avgPrice = tracked ? getAveragePrice(tracked.id) : null;
    const isBelowAvg = avgPrice && item.price < avgPrice * 0.5;

    return (
      <TableRow
        key={`${item.cdkey}-${item.ITEM_ID}-${index}`}
        className={isBelowAvg ? 'bg-green-500/10' : ''}
      >
        <TableCell className="font-medium">
          {item.ITEM_TRUENAME}
          {isTracked && (
            <Badge variant="outline" className="ml-2">
              Tracked
            </Badge>
          )}
        </TableCell>
        <TableCell>
          <span className={isBelowAvg ? 'text-green-600 font-bold' : ''}>
            {formatPriceWithCurrency(item.price, item.pricetype)}
          </span>
          {avgPrice && (
            <span className="text-muted-foreground text-xs ml-2">
              (avg: {formatPrice(avgPrice)})
            </span>
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
            <Input
              placeholder="Search items... (e.g., 一箱壽喜鍋)"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              className="flex-1 min-w-[200px]"
            />
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
          </div>
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
            <div className="flex flex-wrap gap-4">
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
                  <TableHead>Price</TableHead>
                  <TableHead>Server</TableHead>
                  <TableHead>Stall</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {matchingItems.slice(0, 50).map((item, index) => renderItemRow(item, index))}
              </TableBody>
            </Table>
            {matchingItems.length > 50 && (
              <p className="text-sm text-muted-foreground mt-4">
                Showing first 50 of {matchingItems.length} matching items
              </p>
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
                    <TableHead>Price</TableHead>
                    <TableHead>Server</TableHead>
                    <TableHead>Stall</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {otherItems.slice(0, 50).map((item, index) => renderItemRow(item, index + 1000))}
                </TableBody>
              </Table>
              {otherItems.length > 50 && (
                <p className="text-sm text-muted-foreground mt-4">
                  Showing first 50 of {otherItems.length} other items
                </p>
              )}
            </CardContent>
          )}
        </Card>
      )}

      <Dialog open={trackDialogOpen} onOpenChange={setTrackDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Track Item Price</DialogTitle>
            <DialogDescription>
              Set up price alerts for {selectedItem?.ITEM_TRUENAME}
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
            <Button variant="outline" onClick={() => setTrackDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={confirmTrackItem}>Start Tracking</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
