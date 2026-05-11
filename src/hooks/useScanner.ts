'use client';

import { useCallback, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { ScanJobKind, ScanJobState, ScanJobConfig, ScanRunOutcome } from '@/types/scanner';
import { DEFAULT_SCAN_CONFIG } from '@/types/scanner';
import { LockRegistry, startScanLog, finishScanLog } from '@/lib/scan-lock';
import { runDiscovery } from '@/lib/jobs/discovery';
import { runMarketSweep } from '@/lib/jobs/market-sweep';
import { runStatsRefresh } from '@/lib/jobs/stats-refresh';

const KINDS: ScanJobKind[] = ['discovery', 'market_sweep', 'stats_refresh'];

const initialJobState = (kind: ScanJobKind): ScanJobState => ({
  kind,
  status: 'idle',
  progress: null,
  lastError: null,
  pausedUntil: null,
});

export function useScanner() {
  const [jobStates, setJobStates] = useState<Record<ScanJobKind, ScanJobState>>({
    discovery: initialJobState('discovery'),
    market_sweep: initialJobState('market_sweep'),
    stats_refresh: initialJobState('stats_refresh'),
  });
  const [config, setConfig] = useState<ScanJobConfig>(DEFAULT_SCAN_CONFIG);

  const abortControllersRef = useRef<Record<ScanJobKind, AbortController | null>>({
    discovery: null,
    market_sweep: null,
    stats_refresh: null,
  });
  const lockRegistry = useRef(new LockRegistry());

  const updateJob = useCallback((kind: ScanJobKind, patch: Partial<ScanJobState>) => {
    setJobStates((prev) => ({ ...prev, [kind]: { ...prev[kind], ...patch } }));
  }, []);

  const start = useCallback(async (kind: ScanJobKind) => {
    if (!lockRegistry.current.acquire(kind)) return;

    const supabase = createClient();
    const controller = new AbortController();
    abortControllersRef.current[kind] = controller;

    updateJob(kind, {
      status: 'running',
      progress: {
        currentPage: 0,
        totalPages: 0,
        itemsFoundThisRun: 0,
        errorsThisRun: 0,
        latestNote: null,
        startedAt: Date.now(),
        etaSeconds: null,
      },
      lastError: null,
    });

    const scanLogId = await startScanLog(supabase, kind);
    const onProgress = (update: { currentPage: number; totalPages: number; note?: string }) => {
      setJobStates((prev) => {
        const cur = prev[kind];
        if (!cur.progress) return prev;
        const elapsed = (Date.now() - cur.progress.startedAt) / 1000;
        const eta = update.totalPages > 0 && update.currentPage > 0
          ? Math.max(0, (elapsed / update.currentPage) * (update.totalPages - update.currentPage))
          : null;
        return {
          ...prev,
          [kind]: {
            ...cur,
            progress: {
              ...cur.progress,
              currentPage: update.currentPage,
              totalPages: update.totalPages,
              latestNote: update.note ?? cur.progress.latestNote,
              etaSeconds: eta,
            },
          },
        };
      });
    };

    let outcome: ScanRunOutcome;
    try {
      if (kind === 'discovery') {
        outcome = await runDiscovery({
          supabase,
          signal: controller.signal,
          onProgress,
          pages: config.discoveryPages,
        });
      } else if (kind === 'market_sweep') {
        outcome = await runMarketSweep({ supabase, signal: controller.signal, onProgress });
      } else {
        outcome = await runStatsRefresh({
          supabase,
          signal: controller.signal,
          onProgress,
          scope: config.statsRefreshScope,
          nextN: config.statsRefreshNextN,
        });
      }
    } catch (err) {
      outcome = {
        status: 'failed',
        itemsScanned: 0,
        pricesRecorded: 0,
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    }

    if (scanLogId) {
      await finishScanLog(supabase, scanLogId, outcome);
    }

    lockRegistry.current.release(kind);
    abortControllersRef.current[kind] = null;

    updateJob(kind, {
      status: outcome.status === 'completed' ? 'success' : outcome.status === 'aborted' ? 'aborted' : 'failed',
      lastError: outcome.errorMessage,
    });
  }, [config, updateJob]);

  const stop = useCallback((kind: ScanJobKind) => {
    const controller = abortControllersRef.current[kind];
    if (controller) {
      controller.abort();
    }
  }, []);

  return { jobStates, config, setConfig, start, stop, KINDS };
}
