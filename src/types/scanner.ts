// Three job kinds, with discriminated union for state
export type ScanJobKind = 'discovery' | 'market_sweep' | 'stats_refresh';

export type ScanJobStatus = 'idle' | 'running' | 'success' | 'failed' | 'aborted' | 'paused';

export interface ScanJobProgress {
  currentPage: number;
  totalPages: number;
  itemsFoundThisRun: number;
  errorsThisRun: number;
  latestNote: string | null;        // e.g. "Discovered 偷襲密卷"
  startedAt: number;                // Date.now()
  etaSeconds: number | null;        // estimated remaining seconds, null if unknown
}

export interface ScanJobState {
  kind: ScanJobKind;
  status: ScanJobStatus;
  progress: ScanJobProgress | null;
  lastError: string | null;
  pausedUntil: number | null;       // Date.now()-style timestamp; null if not paused
}

// Outcome of a job run, used to write to scan_logs
export interface ScanRunOutcome {
  status: 'completed' | 'failed' | 'aborted';
  itemsScanned: number;
  pricesRecorded: number;
  errorMessage: string | null;
}

// Configuration knobs (defaults in the implementation)
export interface ScanJobConfig {
  // Discovery
  discoveryPages: number;            // default 10

  // Market sweep
  marketSweepStartPage: number;      // default 1

  // Stats refresh
  statsRefreshScope: 'all' | 'next_n';
  statsRefreshNextN: number;         // default 10
}

export const DEFAULT_SCAN_CONFIG: ScanJobConfig = {
  discoveryPages: 10,
  marketSweepStartPage: 1,
  statsRefreshScope: 'all',
  statsRefreshNextN: 10,
};

// Threshold values for "valuable item"
export const VALUABLE_GOLD_THRESHOLD = 40_000;
export const VALUABLE_CRYSTAL_THRESHOLD = 250;
