'use client';

import { useState } from 'react';
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
import { useTrackedItems } from '@/hooks/useTrackedItems';
import { useMarket } from '@/hooks/useMarket';
import { toast } from 'sonner';

export function TrackedItems() {
  const {
    trackedItems,
    loaded,
    removeTrackedItem,
    updateTrackedItem,
    addPriceRecord,
    getAveragePrice,
    getLowestPrice,
    checkAlerts,
  } = useTrackedItems();
  const { search } = useMarket();

  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editItem, setEditItem] = useState<{ id: string; threshold: string } | null>(null);

  const refreshPrices = async (id: string, itemName: string) => {
    setRefreshingId(id);

    try {
      const result = await search({ search: itemName, page: 1 });
      if (!result) {
        toast.error('Failed to fetch prices');
        return;
      }

      // Get all items from the response
      const allItems: { price: number; server: number; stallName: string; coords: string }[] = [];

      for (const [cdkey, items] of Object.entries(result.itemsByCd)) {
        const stall = result.stalls.find(s => s.cdkey === cdkey);
        if (!stall) continue;

        for (const item of items) {
          if (item.ITEM_TRUENAME.includes(itemName)) {
            allItems.push({
              price: item.price,
              server: stall.server,
              stallName: stall.name,
              coords: stall.coords,
            });
          }
        }
      }

      if (allItems.length > 0) {
        addPriceRecord(
          id,
          allItems.map(item => ({
            ...item,
            timestamp: new Date().toISOString(),
          }))
        );

        const prices = allItems.map(i => i.price);
        const alertResult = checkAlerts(id, prices);

        if (alertResult?.triggered) {
          toast.warning(
            `ALERT: ${itemName} is ${alertResult.threshold}% below average! Current: ${alertResult.lowestPrice}, Avg: ${alertResult.avgPrice}`,
            { duration: 10000 }
          );
        } else {
          toast.success(`Updated ${allItems.length} price records for ${itemName}`);
        }
      } else {
        toast.info(`No listings found for ${itemName}`);
      }
    } catch (error) {
      toast.error('Error refreshing prices');
    } finally {
      setRefreshingId(null);
    }
  };

  const handleDelete = (id: string) => {
    setItemToDelete(id);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (itemToDelete) {
      removeTrackedItem(itemToDelete);
      toast.success('Item removed from tracking');
    }
    setDeleteDialogOpen(false);
    setItemToDelete(null);
  };

  const handleEdit = (id: string, threshold: number) => {
    setEditItem({ id, threshold: String(threshold) });
    setEditDialogOpen(true);
  };

  const confirmEdit = () => {
    if (editItem) {
      updateTrackedItem(editItem.id, {
        alertThreshold: parseInt(editItem.threshold) || 50,
      });
      toast.success('Alert threshold updated');
    }
    setEditDialogOpen(false);
    setEditItem(null);
  };

  const toggleActive = (id: string, currentlyActive: boolean) => {
    updateTrackedItem(id, { isActive: !currentlyActive });
    toast.success(`Tracking ${!currentlyActive ? 'enabled' : 'disabled'}`);
  };

  if (!loaded) {
    return (
      <Card>
        <CardContent className="pt-4">
          <p>Loading tracked items...</p>
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
          <CardTitle>Tracked Items ({trackedItems.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Alert Threshold</TableHead>
                <TableHead>Avg Price</TableHead>
                <TableHead>Lowest Seen</TableHead>
                <TableHead>Records</TableHead>
                <TableHead>Last Checked</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {trackedItems.map((item) => {
                const avgPrice = getAveragePrice(item.id);
                const lowestPrice = getLowestPrice(item.id);
                const alertPrice = avgPrice
                  ? Math.round(avgPrice * (1 - item.alertThreshold / 100))
                  : null;

                return (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.itemName}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className="cursor-pointer"
                        onClick={() => handleEdit(item.id, item.alertThreshold)}
                      >
                        {item.alertThreshold}% below avg
                      </Badge>
                      {alertPrice && (
                        <span className="text-xs text-muted-foreground ml-2">
                          (&lt; {alertPrice.toLocaleString()})
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {avgPrice ? avgPrice.toLocaleString() : '-'}
                    </TableCell>
                    <TableCell>
                      {lowestPrice ? (
                        <span className="text-green-600 font-medium">
                          {lowestPrice.toLocaleString()}
                        </span>
                      ) : (
                        '-'
                      )}
                    </TableCell>
                    <TableCell>{item.priceHistory.length}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(item.lastChecked).toLocaleString()}
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
                          onClick={() => refreshPrices(item.id, item.itemName)}
                        >
                          {refreshingId === item.id ? 'Refreshing...' : 'Refresh'}
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleDelete(item.id)}
                        >
                          Remove
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

      {/* Price History Cards */}
      {trackedItems.map((item) => {
        if (item.priceHistory.length === 0) return null;

        const recentPrices = item.priceHistory.slice(-20).reverse();

        return (
          <Card key={`history-${item.id}`}>
            <CardHeader>
              <CardTitle className="text-lg">
                Price History: {item.itemName}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Price</TableHead>
                    <TableHead>Server</TableHead>
                    <TableHead>Stall</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentPrices.map((record, index) => (
                    <TableRow key={index}>
                      <TableCell className="font-medium">
                        {record.price.toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">S{record.server}</Badge>
                      </TableCell>
                      <TableCell>{record.stallName}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {record.coords}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(record.timestamp).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {item.priceHistory.length > 20 && (
                <p className="text-sm text-muted-foreground mt-2">
                  Showing last 20 of {item.priceHistory.length} records
                </p>
              )}
            </CardContent>
          </Card>
        );
      })}

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Tracked Item</DialogTitle>
            <DialogDescription>
              Are you sure you want to stop tracking this item? All price history will be lost.
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

      {/* Edit Threshold Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Alert Threshold</DialogTitle>
            <DialogDescription>
              Set the percentage below average price that triggers an alert
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
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
            <p className="text-sm text-muted-foreground mt-2">
              Alert when price is {editItem?.threshold || 50}% below average
            </p>
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
