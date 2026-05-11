'use client';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { ScanJobKind, ScanJobState } from '@/types/scanner';

const JOB_LABELS: Record<ScanJobKind, string> = {
  discovery: 'Discovery scan',
  market_sweep: 'Market sweep',
  stats_refresh: 'Stats refresh',
};

const JOB_DESCRIPTIONS: Record<ScanJobKind, string> = {
  discovery: 'Scan recent transactions, find items worth tracking (>=40k gold or >=250 crystal).',
  market_sweep: 'Scan all current market listings; save those for tracked items.',
  stats_refresh: 'Per-item refresh of median + 6-month chart cache.',
};

function formatStatus(state: ScanJobState): string {
  switch (state.status) {
    case 'idle': return 'Idle';
    case 'running': return 'Running...';
    case 'success': return 'Last run: success';
    case 'failed': return `Last run: failed${state.lastError ? ` (${state.lastError})` : ''}`;
    case 'aborted': return 'Last run: aborted';
    case 'paused': return `Paused until ${state.pausedUntil ? new Date(state.pausedUntil).toLocaleTimeString() : ''}`;
  }
}

function formatETA(seconds: number | null): string {
  if (seconds == null) return '';
  if (seconds < 60) return `~${Math.ceil(seconds)}s remaining`;
  return `~${Math.ceil(seconds / 60)}m remaining`;
}

export interface ScannerJobCardProps {
  kind: ScanJobKind;
  state: ScanJobState;
  onStart: () => void;
  onStop: () => void;
}

export function ScannerJobCard({ kind, state, onStart, onStop }: ScannerJobCardProps) {
  const isRunning = state.status === 'running';

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">{JOB_LABELS[kind]}</h3>
          <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">{JOB_DESCRIPTIONS[kind]}</p>
          <p className="text-xs text-zinc-500 mt-2">{formatStatus(state)}</p>
        </div>
        <div className="flex gap-2">
          {isRunning ? (
            <Button onClick={onStop} variant="destructive" size="sm">Stop</Button>
          ) : (
            <Button onClick={onStart} size="sm" disabled={state.status === 'paused'}>Start</Button>
          )}
        </div>
      </div>

      {state.progress && (
        <div className="mt-3 space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-zinc-600 dark:text-zinc-400">
              Page {state.progress.currentPage} / {state.progress.totalPages || '?'}
            </span>
            <span className="text-zinc-500">{formatETA(state.progress.etaSeconds)}</span>
          </div>
          {state.progress.latestNote && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">{state.progress.latestNote}</p>
          )}
        </div>
      )}
    </Card>
  );
}
