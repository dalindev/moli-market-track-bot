import type { ScanJobKind, ScanRunOutcome } from '@/types/scanner';
import type { SupabaseClient } from '@supabase/supabase-js';

export class LockRegistry {
  private held = new Set<ScanJobKind>();

  acquire(kind: ScanJobKind): boolean {
    if (this.held.has(kind)) return false;
    this.held.add(kind);
    return true;
  }

  release(kind: ScanJobKind): void {
    this.held.delete(kind);
  }

  isHeld(kind: ScanJobKind): boolean {
    return this.held.has(kind);
  }
}

// Map our internal job kind to the existing scan_logs.scan_type values
const SCAN_TYPE_MAP: Record<ScanJobKind, string> = {
  discovery: 'transaction',
  market_sweep: 'full',
  stats_refresh: 'tracked',
};

// DB status column only accepts 'running' | 'completed' | 'failed'
type DbScanStatus = 'running' | 'completed' | 'failed';

function toDbStatus(outcome: ScanRunOutcome['status']): DbScanStatus {
  if (outcome === 'completed') return 'completed';
  // 'aborted' and 'failed' both map to 'failed'
  return 'failed';
}

// Write a 'running' row, return its id for later update
export async function startScanLog(
  supabase: SupabaseClient,
  kind: ScanJobKind
): Promise<string | null> {
  const { data, error } = await supabase
    .from('scan_logs')
    .insert({
      scan_type: SCAN_TYPE_MAP[kind],
      items_scanned: 0,
      prices_recorded: 0,
      started_at: new Date().toISOString(),
      status: 'running',
    })
    .select('id')
    .single();
  if (error) {
    console.error('[scan-lock] failed to start scan log:', error.message);
    return null;
  }
  return data.id;
}

export async function finishScanLog(
  supabase: SupabaseClient,
  scanLogId: string,
  outcome: ScanRunOutcome
): Promise<void> {
  // Map 'aborted' to 'failed' so the DB CHECK constraint is satisfied.
  // If the caller didn't supply an error message, note the abort in error_message.
  const dbStatus = toDbStatus(outcome.status);
  const errorMessage =
    outcome.status === 'aborted' && !outcome.errorMessage
      ? 'aborted'
      : outcome.errorMessage;

  const { error } = await supabase
    .from('scan_logs')
    .update({
      items_scanned: outcome.itemsScanned,
      prices_recorded: outcome.pricesRecorded,
      completed_at: new Date().toISOString(),
      status: dbStatus,
      error_message: errorMessage,
    })
    .eq('id', scanLogId);
  if (error) {
    console.error('[scan-lock] failed to finish scan log:', error.message);
  }
}
