'use client';

import { useScanner } from '@/hooks/useScanner';
import { ScannerJobCard } from '@/components/ScannerJobCard';
import { DiscoveredItemsList } from '@/components/DiscoveredItemsList';
import { Card } from '@/components/ui/card';

const VISIBLE_KINDS = ['market_sweep', 'stats_refresh'] as const;

export function Scanner() {
  const { jobStates, start, stop } = useScanner();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Scanner</h2>
        <p className="text-zinc-600 dark:text-zinc-400 mt-1">
          Run scans to populate the deal-spotter database. Each scan is rate-limited (1.5–3s per request).
        </p>
      </div>

      <p className="text-sm text-zinc-500">
        Market sweep auto-discovers items and pets directly from current listings. Stats refresh fills in history.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {VISIBLE_KINDS.map((kind) => (
          <ScannerJobCard
            key={kind}
            kind={kind}
            state={jobStates[kind]}
            onStart={() => start(kind)}
            onStop={() => stop(kind)}
          />
        ))}
      </div>

      <Card className="p-4">
        <h3 className="font-semibold mb-3 text-zinc-900 dark:text-zinc-100">Discovered items (top 50 by gold value)</h3>
        <DiscoveredItemsList />
      </Card>
    </div>
  );
}
