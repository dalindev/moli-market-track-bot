'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  hasDataToMigrate,
  getMigrationCount,
  migrateFromLocalStorage,
  clearOldData,
  MigrationResult,
} from '@/lib/migration';
import { toast } from 'sonner';

export function MigrationPrompt() {
  const [showPrompt, setShowPrompt] = useState(false);
  const [itemCount, setItemCount] = useState(0);
  const [migrating, setMigrating] = useState(false);
  const [result, setResult] = useState<MigrationResult | null>(null);
  const [showResultDialog, setShowResultDialog] = useState(false);

  useEffect(() => {
    // Check if there's data to migrate
    if (hasDataToMigrate()) {
      setItemCount(getMigrationCount());
      setShowPrompt(true);
    }
  }, []);

  const handleMigrate = async () => {
    setMigrating(true);
    try {
      const migrationResult = await migrateFromLocalStorage();
      setResult(migrationResult);
      setShowResultDialog(true);

      if (migrationResult.success && migrationResult.itemsMigrated > 0) {
        toast.success(
          `Migration complete! ${migrationResult.itemsMigrated} items and ${migrationResult.priceRecordsMigrated} price records migrated.`
        );
        setShowPrompt(false);
      } else if (migrationResult.errors.length > 0) {
        toast.error('Migration completed with errors. Check the details.');
      }
    } catch (err) {
      toast.error('Migration failed');
      console.error(err);
    } finally {
      setMigrating(false);
    }
  };

  const handleSkip = () => {
    setShowPrompt(false);
    toast.info('Migration skipped. Your local data is still available.');
  };

  const handleClearOldData = () => {
    clearOldData();
    toast.success('Old localStorage data cleared');
    setShowResultDialog(false);
  };

  if (!showPrompt) return null;

  return (
    <>
      <Card className="border-blue-500 bg-blue-50 dark:bg-blue-950">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Badge variant="secondary">Migration Available</Badge>
            Data Migration to Cloud
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm mb-4">
            We found <strong>{itemCount} tracked items</strong> in your browser&apos;s local storage.
            Would you like to migrate them to the cloud database? This will:
          </p>
          <ul className="list-disc list-inside text-sm mb-4 space-y-1">
            <li>Preserve all your tracked items and price history</li>
            <li>Enable automatic background price scanning</li>
            <li>Allow access from any device</li>
          </ul>
          <div className="flex gap-2">
            <Button onClick={handleMigrate} disabled={migrating}>
              {migrating ? 'Migrating...' : 'Migrate to Cloud'}
            </Button>
            <Button variant="outline" onClick={handleSkip} disabled={migrating}>
              Skip for Now
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={showResultDialog} onOpenChange={setShowResultDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Migration Results</DialogTitle>
            <DialogDescription>
              {result?.success
                ? 'Migration completed successfully!'
                : 'Migration completed with some issues.'}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div className="flex gap-4">
              <div className="text-center">
                <p className="text-2xl font-bold text-green-600">
                  {result?.itemsMigrated ?? 0}
                </p>
                <p className="text-sm text-muted-foreground">Items Migrated</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-blue-600">
                  {result?.priceRecordsMigrated ?? 0}
                </p>
                <p className="text-sm text-muted-foreground">Price Records</p>
              </div>
            </div>
            {result?.errors && result.errors.length > 0 && (
              <div className="mt-4">
                <p className="text-sm font-medium text-red-600 mb-2">
                  Errors ({result.errors.length}):
                </p>
                <ul className="text-xs text-muted-foreground space-y-1 max-h-32 overflow-y-auto">
                  {result.errors.map((error, i) => (
                    <li key={i}>{error}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <DialogFooter>
            {result?.success && result.itemsMigrated > 0 && (
              <Button variant="outline" onClick={handleClearOldData}>
                Clear Old Data
              </Button>
            )}
            <Button onClick={() => setShowResultDialog(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
