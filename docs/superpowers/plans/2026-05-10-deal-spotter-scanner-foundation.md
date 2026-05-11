# Deal Spotter — Scanner Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the data-collection foundation: schema, three scan jobs (Discovery, Market sweep, Stats refresh), the `/scanner` UI to drive them, image fetching, and a basic discovered-items view. After this plan, the user can run scans and the DB will populate with valuable items, market snapshots, and cached stats.

**Architecture:** Client-side scanner in Next.js. Pure-function job logic (testable in isolation). React hook orchestrates state. Supabase JS client for persistence. Rate limited at 1.5–3s/request with exponential backoff and a circuit breaker. Pre-parsed `marketrecord.php` fields (`item_name`, `qty`, `unit_price`, `stats.median`, `trend6m`) reduce client-side computation.

**Tech Stack:** Next.js 16 + React 19 + TypeScript (strict), Supabase, Vitest for unit tests.

**Spec:** `docs/superpowers/specs/2026-05-10-deal-spotter-design.md`

---

## File Map

**New files:**
```
vitest.config.ts
src/types/scanner.ts                          — scanner state & job types
src/lib/rate-limiter.ts                       — sleep+jitter, retry, backoff
src/lib/rate-limiter.test.ts
src/lib/exchange-rate.ts                      — derive gold/crystal rate from 魔幣箱
src/lib/exchange-rate.test.ts
src/lib/threshold.ts                          — is-this-item-valuable gate
src/lib/threshold.test.ts
src/lib/scan-lock.ts                          — single-instance lock + circuit breaker via scan_logs
src/lib/scan-lock.test.ts
src/lib/api-clients/market.ts                 — typed fetch wrapper for /api/market
src/lib/api-clients/marketrecord.ts           — typed fetch wrapper for /api/marketrecord (new fields)
src/lib/jobs/discovery.ts                     — Discovery scan job (pure orchestration)
src/lib/jobs/discovery.test.ts
src/lib/jobs/market-sweep.ts                  — Market sweep job
src/lib/jobs/market-sweep.test.ts
src/lib/jobs/stats-refresh.ts                 — Stats refresh job
src/lib/jobs/stats-refresh.test.ts
src/hooks/useScanner.ts                       — orchestration hook for all three jobs
src/components/Scanner.tsx                    — page-level scanner UI
src/components/ScannerJobCard.tsx             — one of three job cards
src/components/DiscoveredItemsList.tsx        — basic table of items in DB
src/app/scanner/page.tsx                      — Next.js route
src/app/api/save-item-image/route.ts          — server-only image saver
supabase/migrations/20260510000001_deal_spotter_schema.sql
public/item-images/.gitkeep                   — placeholder so dir is tracked
```

**Modified files:**
```
package.json                                  — add vitest deps + test script
src/types/market.ts                           — add new marketrecord log fields, stats, trend6m
src/types/supabase.ts                         — regenerate after migration (or hand-edit)
src/app/page.tsx                              — add /scanner link in header
.gitignore                                    — ignore public/item-images/*.png/.gif except .gitkeep
```

---

## Phase 1: Test framework + type extensions

### Task 1: Add Vitest

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: Install vitest and supporting deps**

Run:
```bash
pnpm add -D vitest @vitest/ui @types/node
```

Expected: vitest and @vitest/ui appear in devDependencies.

- [ ] **Step 2: Add test scripts to package.json**

Edit `package.json` so the `scripts` block reads:

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

- [ ] **Step 3: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

- [ ] **Step 4: Sanity-check vitest runs (no tests yet, should pass with "no test files")**

Run: `pnpm test`
Expected: exits 0 with a message about no test files found.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml vitest.config.ts
git commit -m "chore: add vitest test framework"
```

---

### Task 2: Extend marketrecord types with new API fields

**Files:**
- Modify: `src/types/market.ts`

- [ ] **Step 1: Add new fields to PriceHistoryLogRaw and add new top-level response types**

Append to `src/types/market.ts` (after the existing `PriceHistoryLogRaw` interface):

```typescript
// New fields returned by the live marketrecord.php endpoint
// (extends PriceHistoryLogRaw — keep backward compat)
export interface PriceHistoryLogExtended extends PriceHistoryLogRaw {
  ts: number;              // same as time, in seconds
  qty: number;             // pre-parsed quantity (replaces buff regex)
  item_name: string;       // pre-parsed item name (replaces buff substring)
  gross_price: number;     // total transaction price (price * qty + fees)
  unit_price: number;      // per-unit price (replaces price/qty math)
  unit_gross_price: number;
  currency_label: string;  // '金幣' or '魔晶'
}

// Server-computed stats block (new in 2026-05 endpoint)
export interface MarketRecordStats {
  count: number;
  min: number;
  max: number;
  avg: number;
  median: number;
  trend: number[];           // recent unit prices
  is_unit_price: boolean;
  pricetype_mixed: boolean;
  pricetype_single: number | null;  // 0, 1, or null if mixed
}

// 6-month daily aggregates with IQR-based outlier counts
export interface Trend6mDay {
  day: string;        // 'YYYY-MM-DD'
  avg: number;        // IQR-filtered average
  min: number;        // IQR-filtered minimum
  max: number;        // IQR-filtered maximum
  raw_min: number;    // un-filtered minimum (LOW outliers = past misprices)
  raw_max: number;    // un-filtered maximum
  cnt: number;        // total transaction count this day
  hi_out: number;     // count of HIGH outliers
  lo_out: number;     // count of LOW outliers (misprices)
}

export interface Trend6m {
  days: Trend6mDay[];
  pricetype_single: number | null;
  start_day: string;
  end_day: string;
  chart_mode: string;   // 'daily_median_iqr'
}

// Extended response — superset of PriceHistoryResponseRaw
export interface MarketRecordResponseV2 {
  page: number;
  perPage: number;
  totalFiltered: number;
  totalFilteredRaw: number;
  resultsTruncated: boolean;
  range: string;
  sort: string;
  currency: string;
  type: string;
  logs: PriceHistoryLogExtended[];
  stats: MarketRecordStats;
  trend6m: Trend6m;
}
```

- [ ] **Step 2: Run typecheck (no implementation yet, just type sanity)**

Run: `pnpm exec tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/types/market.ts
git commit -m "feat: add types for extended marketrecord.php response"
```

---

### Task 3: Add scanner state types

**Files:**
- Create: `src/types/scanner.ts`

- [ ] **Step 1: Write the type definitions**

```typescript
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
  statsRefreshScope: 'next_n',
  statsRefreshNextN: 10,
};

// Threshold values for "valuable item"
export const VALUABLE_GOLD_THRESHOLD = 40_000;
export const VALUABLE_CRYSTAL_THRESHOLD = 250;
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/types/scanner.ts
git commit -m "feat: add scanner state and config types"
```

---

## Phase 2: Database migration

### Task 4: Add schema columns + derived_exchange_rate table

**Files:**
- Create: `supabase/migrations/20260510000001_deal_spotter_schema.sql`

- [ ] **Step 1: Write migration SQL**

```sql
-- Deal spotter schema additions
-- See docs/superpowers/specs/2026-05-10-deal-spotter-design.md

-- Extend items with auto-discovery + cached server stats + image
ALTER TABLE items ADD COLUMN IF NOT EXISTS is_auto_discovered BOOLEAN DEFAULT FALSE;
ALTER TABLE items ADD COLUMN IF NOT EXISTS median_gold_value INTEGER;
ALTER TABLE items ADD COLUMN IF NOT EXISTS median_crystal_value INTEGER;
ALTER TABLE items ADD COLUMN IF NOT EXISTS min_sold_gold INTEGER;
ALTER TABLE items ADD COLUMN IF NOT EXISTS min_sold_crystal INTEGER;
ALTER TABLE items ADD COLUMN IF NOT EXISTS max_sold_gold INTEGER;
ALTER TABLE items ADD COLUMN IF NOT EXISTS max_sold_crystal INTEGER;
ALTER TABLE items ADD COLUMN IF NOT EXISTS sample_count_gold INTEGER DEFAULT 0;
ALTER TABLE items ADD COLUMN IF NOT EXISTS sample_count_crystal INTEGER DEFAULT 0;
ALTER TABLE items ADD COLUMN IF NOT EXISTS image_path TEXT;
ALTER TABLE items ADD COLUMN IF NOT EXISTS last_history_refresh TIMESTAMPTZ;
ALTER TABLE items ADD COLUMN IF NOT EXISTS trend6m_cache JSONB;
ALTER TABLE items ADD COLUMN IF NOT EXISTS trend6m_cached_at TIMESTAMPTZ;

-- Indices for the leaderboard / deals queries (used by Plan 2)
CREATE INDEX IF NOT EXISTS idx_items_auto_discovered ON items(is_auto_discovered) WHERE is_auto_discovered = TRUE;
CREATE INDEX IF NOT EXISTS idx_items_median_gold ON items(median_gold_value DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_items_last_history_refresh ON items(last_history_refresh ASC NULLS FIRST);

-- Derived exchange rate table (gold per crystal, from 魔幣箱 transactions)
CREATE TABLE IF NOT EXISTS derived_exchange_rate (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gold_per_crystal NUMERIC(10,2) NOT NULL,
  source_item_name TEXT NOT NULL,
  sample_size INTEGER NOT NULL,
  median_crystal_price INTEGER NOT NULL,
  computed_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_derived_exchange_rate_computed_at ON derived_exchange_rate(computed_at DESC);

ALTER TABLE derived_exchange_rate ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to derived_exchange_rate" ON derived_exchange_rate FOR ALL USING (true) WITH CHECK (true);
GRANT ALL ON derived_exchange_rate TO anon, authenticated, service_role;
```

- [ ] **Step 2: Push migration**

Run:
```bash
supabase db push
```

Expected: migration applied. Verify in Supabase Studio that the new columns and table exist.

- [ ] **Step 3: Verify with a SQL probe**

Run from any postgres-capable shell (or Supabase Studio SQL editor):
```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'items' AND column_name IN ('is_auto_discovered', 'median_gold_value', 'trend6m_cache');
```
Expected: 3 rows returned.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260510000001_deal_spotter_schema.sql
git commit -m "feat(db): deal spotter schema additions"
```

---

## Phase 3: Core utilities (TDD)

### Task 5: Rate limiter

**Files:**
- Create: `src/lib/rate-limiter.ts`
- Create: `src/lib/rate-limiter.test.ts`

The rate limiter provides three primitives:
1. `jitteredSleep(minMs, maxMs)` — random sleep within a range.
2. `fetchWithRetry(url, options, retryConfig)` — fetch with exponential backoff and 429 handling.
3. `CircuitBreaker` — tracks consecutive failures, returns paused-until timestamp.

- [ ] **Step 1: Write the failing tests**

`src/lib/rate-limiter.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { jitteredSleep, CircuitBreaker, fetchWithRetry } from './rate-limiter';

describe('jitteredSleep', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('sleeps for a duration within the given range', async () => {
    const promise = jitteredSleep(100, 200);
    await vi.advanceTimersByTimeAsync(200);
    await expect(promise).resolves.toBeUndefined();
  });
});

describe('CircuitBreaker', () => {
  it('does not trip on isolated failures', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, pauseMs: 1000 });
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.pausedUntil()).toBeNull();
  });

  it('trips after threshold consecutive failures', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, pauseMs: 1000 });
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    const until = cb.pausedUntil();
    expect(until).not.toBeNull();
    expect(until!).toBeGreaterThan(Date.now());
  });

  it('resets failure count on success', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, pauseMs: 1000 });
    cb.recordFailure();
    cb.recordFailure();
    cb.recordSuccess();
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.pausedUntil()).toBeNull();
  });
});

describe('fetchWithRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('returns response on first success', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    const promise = fetchWithRetry('https://example.com', {}, { maxRetries: 3, baseDelayMs: 100, fetchFn: mockFetch });
    await vi.runAllTimersAsync();
    const res = await promise;
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('retries on 5xx with exponential backoff', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(new Response('err', { status: 500 }))
      .mockResolvedValueOnce(new Response('err', { status: 503 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const promise = fetchWithRetry('https://example.com', {}, { maxRetries: 3, baseDelayMs: 100, fetchFn: mockFetch });
    await vi.runAllTimersAsync();
    const res = await promise;
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('honors Retry-After header on 429', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(new Response('rate-limited', { status: 429, headers: { 'Retry-After': '5' } }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const promise = fetchWithRetry('https://example.com', {}, { maxRetries: 3, baseDelayMs: 100, fetchFn: mockFetch });
    await vi.runAllTimersAsync();
    const res = await promise;
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('throws after max retries', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('err', { status: 500 }));
    const promise = fetchWithRetry('https://example.com', {}, { maxRetries: 2, baseDelayMs: 100, fetchFn: mockFetch });
    await vi.runAllTimersAsync();
    await expect(promise).rejects.toThrow(/Max retries/);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm test src/lib/rate-limiter.test.ts`
Expected: tests fail with "Cannot find module './rate-limiter'".

- [ ] **Step 3: Implement rate-limiter.ts**

`src/lib/rate-limiter.ts`:

```typescript
export function jitteredSleep(minMs: number, maxMs: number): Promise<void> {
  const ms = minMs + Math.random() * (maxMs - minMs);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface CircuitBreakerConfig {
  failureThreshold: number;
  pauseMs: number;
}

export class CircuitBreaker {
  private failures = 0;
  private _pausedUntil: number | null = null;
  constructor(private readonly config: CircuitBreakerConfig) {}

  recordFailure(): void {
    this.failures += 1;
    if (this.failures >= this.config.failureThreshold) {
      this._pausedUntil = Date.now() + this.config.pauseMs;
    }
  }

  recordSuccess(): void {
    this.failures = 0;
    this._pausedUntil = null;
  }

  pausedUntil(): number | null {
    if (this._pausedUntil && this._pausedUntil <= Date.now()) {
      this._pausedUntil = null;
    }
    return this._pausedUntil;
  }

  reset(): void {
    this.failures = 0;
    this._pausedUntil = null;
  }
}

export interface FetchRetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  fetchFn?: typeof fetch;
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  config: FetchRetryConfig
): Promise<Response> {
  const fetchFn = config.fetchFn ?? fetch;
  let lastStatus = 0;

  for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
    const res = await fetchFn(url, init);
    if (res.ok) return res;

    lastStatus = res.status;

    // Don't retry 4xx except 429
    if (res.status >= 400 && res.status < 500 && res.status !== 429) {
      return res;
    }

    if (attempt === config.maxRetries) break;

    let delayMs: number;
    if (res.status === 429) {
      const retryAfter = res.headers.get('Retry-After');
      delayMs = retryAfter ? Number(retryAfter) * 1000 : 30_000;
    } else {
      delayMs = config.baseDelayMs * Math.pow(3, attempt); // 100, 300, 900, 2700...
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error(`Max retries exceeded (last status: ${lastStatus})`);
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm test src/lib/rate-limiter.test.ts`
Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rate-limiter.ts src/lib/rate-limiter.test.ts
git commit -m "feat: rate limiter with backoff, jitter, and circuit breaker"
```

---

### Task 6: Threshold gate (is-this-item-valuable)

**Files:**
- Create: `src/lib/threshold.ts`
- Create: `src/lib/threshold.test.ts`

- [ ] **Step 1: Write the failing tests**

`src/lib/threshold.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { computeMedian, isValuable } from './threshold';
import { VALUABLE_GOLD_THRESHOLD, VALUABLE_CRYSTAL_THRESHOLD } from '@/types/scanner';

describe('computeMedian', () => {
  it('returns 0 for empty array', () => {
    expect(computeMedian([])).toBe(0);
  });
  it('returns the value itself for a single element', () => {
    expect(computeMedian([42])).toBe(42);
  });
  it('returns the middle of an odd-length array', () => {
    expect(computeMedian([1, 5, 3])).toBe(3);
  });
  it('returns the average of the two middle values for even length', () => {
    expect(computeMedian([1, 2, 3, 4])).toBe(2.5);
  });
});

describe('isValuable', () => {
  it('gold median above threshold qualifies (gold currency)', () => {
    expect(isValuable({ pricetype: 0, median: VALUABLE_GOLD_THRESHOLD })).toBe(true);
    expect(isValuable({ pricetype: 0, median: VALUABLE_GOLD_THRESHOLD - 1 })).toBe(false);
  });
  it('crystal median above threshold qualifies (crystal currency)', () => {
    expect(isValuable({ pricetype: 1, median: VALUABLE_CRYSTAL_THRESHOLD })).toBe(true);
    expect(isValuable({ pricetype: 1, median: VALUABLE_CRYSTAL_THRESHOLD - 1 })).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm test src/lib/threshold.test.ts`
Expected: fails — module not found.

- [ ] **Step 3: Implement threshold.ts**

```typescript
import { VALUABLE_GOLD_THRESHOLD, VALUABLE_CRYSTAL_THRESHOLD } from '@/types/scanner';

export function computeMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export interface ValuableInput {
  pricetype: number; // 0 = gold, 1 = crystal
  median: number;
}

export function isValuable(input: ValuableInput): boolean {
  if (input.pricetype === 0) return input.median >= VALUABLE_GOLD_THRESHOLD;
  if (input.pricetype === 1) return input.median >= VALUABLE_CRYSTAL_THRESHOLD;
  return false;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm test src/lib/threshold.test.ts`
Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/threshold.ts src/lib/threshold.test.ts
git commit -m "feat: valuable-item threshold gate"
```

---

### Task 7: Exchange rate derivation from 魔幣箱

**Files:**
- Create: `src/lib/exchange-rate.ts`
- Create: `src/lib/exchange-rate.test.ts`

The function takes recent transaction logs and returns the gold-per-crystal rate derived from `魔幣箱（100萬）` sales. Used by Discovery job after each run.

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from 'vitest';
import { deriveExchangeRate } from './exchange-rate';
import type { PriceHistoryLogExtended } from '@/types/market';

function makeLog(overrides: Partial<PriceHistoryLogExtended>): PriceHistoryLogExtended {
  return {
    id: 0,
    cdkey: '',
    buycdkey: '',
    buyname: '',
    buff: '',
    price: 0,
    pricetype: 1,
    time: 0,
    time_text: '',
    check: 0,
    ts: 0,
    qty: 1,
    item_name: '',
    gross_price: 0,
    unit_price: 0,
    unit_gross_price: 0,
    currency_label: '魔晶',
    ...overrides,
  };
}

describe('deriveExchangeRate', () => {
  it('returns null when no 100w box sales found', () => {
    const logs: PriceHistoryLogExtended[] = [
      makeLog({ item_name: '某道具', pricetype: 0, unit_price: 1000 }),
    ];
    expect(deriveExchangeRate(logs)).toBeNull();
  });

  it('derives rate from 100w box crystal sales (gold_per_crystal = 1_000_000 / median)', () => {
    const logs: PriceHistoryLogExtended[] = [
      makeLog({ item_name: '魔幣箱（100萬）', pricetype: 1, unit_price: 3800 }),
      makeLog({ item_name: '魔幣箱（100萬）', pricetype: 1, unit_price: 3854 }),
      makeLog({ item_name: '魔幣箱（100萬）', pricetype: 1, unit_price: 3900 }),
    ];
    const result = deriveExchangeRate(logs);
    expect(result).not.toBeNull();
    expect(result!.gold_per_crystal).toBeCloseTo(1_000_000 / 3854, 1);
    expect(result!.source_item_name).toBe('魔幣箱（100萬）');
    expect(result!.sample_size).toBe(3);
    expect(result!.median_crystal_price).toBe(3854);
  });

  it('ignores gold sales of 100w box (only crystal trades inform the rate)', () => {
    const logs: PriceHistoryLogExtended[] = [
      makeLog({ item_name: '魔幣箱（100萬）', pricetype: 0, unit_price: 999_999 }), // ignored
      makeLog({ item_name: '魔幣箱（100萬）', pricetype: 1, unit_price: 3800 }),
    ];
    const result = deriveExchangeRate(logs);
    expect(result).not.toBeNull();
    expect(result!.sample_size).toBe(1);
  });

  it('falls back to 10w box if 100w box is unavailable', () => {
    const logs: PriceHistoryLogExtended[] = [
      makeLog({ item_name: '魔幣箱（10萬）', pricetype: 1, unit_price: 380 }),
      makeLog({ item_name: '魔幣箱（10萬）', pricetype: 1, unit_price: 385 }),
    ];
    const result = deriveExchangeRate(logs);
    expect(result).not.toBeNull();
    expect(result!.source_item_name).toBe('魔幣箱（10萬）');
    // 10w box: gold_per_crystal = 100_000 / median
    expect(result!.gold_per_crystal).toBeCloseTo(100_000 / 382.5, 1);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm test src/lib/exchange-rate.test.ts`
Expected: fails — module not found.

- [ ] **Step 3: Implement exchange-rate.ts**

```typescript
import { computeMedian } from './threshold';
import type { PriceHistoryLogExtended } from '@/types/market';

export interface ExchangeRateResult {
  gold_per_crystal: number;
  source_item_name: string;
  sample_size: number;
  median_crystal_price: number;
}

interface BoxSpec {
  name: string;
  goldValue: number;
}

const BOX_SPECS: BoxSpec[] = [
  { name: '魔幣箱（100萬）', goldValue: 1_000_000 },
  { name: '魔幣箱（10萬）', goldValue: 100_000 },
];

export function deriveExchangeRate(logs: PriceHistoryLogExtended[]): ExchangeRateResult | null {
  for (const spec of BOX_SPECS) {
    const crystalPrices = logs
      .filter((l) => l.item_name === spec.name && l.pricetype === 1 && l.unit_price > 0)
      .map((l) => l.unit_price);

    if (crystalPrices.length === 0) continue;

    const median = computeMedian(crystalPrices);
    if (median <= 0) continue;

    return {
      gold_per_crystal: spec.goldValue / median,
      source_item_name: spec.name,
      sample_size: crystalPrices.length,
      median_crystal_price: Math.round(median),
    };
  }

  return null;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm test src/lib/exchange-rate.test.ts`
Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/exchange-rate.ts src/lib/exchange-rate.test.ts
git commit -m "feat: derive gold/crystal rate from 魔幣箱 transactions"
```

---

### Task 8: Scan lock + circuit breaker integration with Supabase scan_logs

**Files:**
- Create: `src/lib/scan-lock.ts`
- Create: `src/lib/scan-lock.test.ts`

This module:
- Acquires an in-memory lock per `ScanJobKind` so only one runs at a time.
- Writes/updates rows in the `scan_logs` table for visibility.
- Implements the "another scan is running" guard.

We use an in-memory lock (browser tab is the single client). The `scan_logs` row is for audit/debug only — not for cross-tab locking.

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from 'vitest';
import { LockRegistry } from './scan-lock';

describe('LockRegistry', () => {
  it('grants lock when free', () => {
    const r = new LockRegistry();
    expect(r.acquire('discovery')).toBe(true);
  });

  it('refuses lock when already held', () => {
    const r = new LockRegistry();
    r.acquire('discovery');
    expect(r.acquire('discovery')).toBe(false);
  });

  it('allows different kinds simultaneously', () => {
    const r = new LockRegistry();
    expect(r.acquire('discovery')).toBe(true);
    expect(r.acquire('market_sweep')).toBe(true);
  });

  it('release allows re-acquire', () => {
    const r = new LockRegistry();
    r.acquire('discovery');
    r.release('discovery');
    expect(r.acquire('discovery')).toBe(true);
  });

  it('isHeld reports correct state', () => {
    const r = new LockRegistry();
    expect(r.isHeld('discovery')).toBe(false);
    r.acquire('discovery');
    expect(r.isHeld('discovery')).toBe(true);
    r.release('discovery');
    expect(r.isHeld('discovery')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm test src/lib/scan-lock.test.ts`
Expected: fails — module not found.

- [ ] **Step 3: Implement scan-lock.ts**

```typescript
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
  const { error } = await supabase
    .from('scan_logs')
    .update({
      items_scanned: outcome.itemsScanned,
      prices_recorded: outcome.pricesRecorded,
      completed_at: new Date().toISOString(),
      status: outcome.status,
      error_message: outcome.errorMessage,
    })
    .eq('id', scanLogId);
  if (error) {
    console.error('[scan-lock] failed to finish scan log:', error.message);
  }
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm test src/lib/scan-lock.test.ts`
Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/scan-lock.ts src/lib/scan-lock.test.ts
git commit -m "feat: per-kind scan lock registry + scan_logs writers"
```

---

## Phase 4: API clients

### Task 9: Market API client

**Files:**
- Create: `src/lib/api-clients/market.ts`

Thin typed wrapper around `/api/market`. No tests — it's an integration boundary and the real test is end-to-end.

- [ ] **Step 1: Write the client**

```typescript
import { fetchWithRetry, jitteredSleep } from '../rate-limiter';
import type { MarketResponse } from '@/types/market';

export interface MarketFetchParams {
  page: number;
  search?: string;
  type?: 'all' | '道具攤位' | '寵物攤位';
  server?: 'all' | '1' | '2' | '3' | '4' | '5';
  exact?: boolean;
}

export interface MarketFetchOptions {
  signal?: AbortSignal;
  minDelayMs?: number;     // default 1500
  maxDelayMs?: number;     // default 3000
}

export async function fetchMarketPage(
  params: MarketFetchParams,
  opts: MarketFetchOptions = {}
): Promise<MarketResponse> {
  const minDelay = opts.minDelayMs ?? 1500;
  const maxDelay = opts.maxDelayMs ?? 3000;
  await jitteredSleep(minDelay, maxDelay);

  if (opts.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  const qs = new URLSearchParams({
    page: String(params.page),
    search: params.search ?? '',
    type: params.type ?? 'all',
    server: params.server ?? 'all',
    exact: params.exact ? '1' : '0',
  });

  const res = await fetchWithRetry(
    `/api/market?${qs.toString()}`,
    { signal: opts.signal },
    { maxRetries: 3, baseDelayMs: 5_000 }
  );

  if (!res.ok) {
    throw new Error(`Market API returned ${res.status}`);
  }
  return (await res.json()) as MarketResponse;
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/api-clients/market.ts
git commit -m "feat: rate-limited market.php client"
```

---

### Task 10: MarketRecord API client (with new fields)

**Files:**
- Create: `src/lib/api-clients/marketrecord.ts`

- [ ] **Step 1: Write the client**

```typescript
import { fetchWithRetry, jitteredSleep } from '../rate-limiter';
import type { MarketRecordResponseV2 } from '@/types/market';

export type MarketRecordSort = 'time_desc' | 'time_asc' | 'price_asc' | 'price_desc';
export type MarketRecordRange = '1d' | '7d' | '30d' | '6m';
export type MarketRecordCurrency = 'all' | '0' | '1';
export type MarketRecordType = 'all' | 'item' | 'pet';

export interface MarketRecordFetchParams {
  page: number;
  search?: string;
  type?: MarketRecordType;
  range?: MarketRecordRange;
  currency?: MarketRecordCurrency;
  sort?: MarketRecordSort;
}

export interface MarketRecordFetchOptions {
  signal?: AbortSignal;
  minDelayMs?: number;
  maxDelayMs?: number;
}

export async function fetchMarketRecord(
  params: MarketRecordFetchParams,
  opts: MarketRecordFetchOptions = {}
): Promise<MarketRecordResponseV2> {
  const minDelay = opts.minDelayMs ?? 1500;
  const maxDelay = opts.maxDelayMs ?? 3000;
  await jitteredSleep(minDelay, maxDelay);

  if (opts.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  const qs = new URLSearchParams({
    page: String(params.page),
    search: params.search ?? '',
    type: params.type ?? 'all',
    range: params.range ?? '30d',
    currency: params.currency ?? 'all',
    sort: params.sort ?? 'time_desc',
  });

  const res = await fetchWithRetry(
    `/api/marketrecord?${qs.toString()}`,
    { signal: opts.signal },
    { maxRetries: 3, baseDelayMs: 5_000 }
  );

  if (!res.ok) {
    throw new Error(`MarketRecord API returned ${res.status}`);
  }
  return (await res.json()) as MarketRecordResponseV2;
}
```

- [ ] **Step 2: Update `/api/marketrecord/route.ts` to forward new params**

Modify `src/app/api/marketrecord/route.ts` — replace the `params` block so it also passes `range`, `currency`, `sort` if present:

```typescript
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const params = new URLSearchParams({
    ajax: '1',
    page: searchParams.get('page') || '1',
    search: searchParams.get('search') || '',
    type: searchParams.get('type') || 'all',
    range: searchParams.get('range') || '30d',
    currency: searchParams.get('currency') || 'all',
    sort: searchParams.get('sort') || 'time_desc',
  });

  try {
    const response = await fetch(
      `https://member.starcg.net/marketrecord.php?${params.toString()}`,
      {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (compatible; StarCGMarketTracker/1.0)',
        },
        next: { revalidate: 60 }, // 1 min cache (down from 5 min — we need fresher data for the scanner)
      }
    );

    if (!response.ok) {
      throw new Error(`API responded with status: ${response.status}`);
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Market Record API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch market record data' },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/api-clients/marketrecord.ts src/app/api/marketrecord/route.ts
git commit -m "feat: rate-limited marketrecord client with new range/sort/currency params"
```

---

## Phase 5: Scan jobs (TDD where pure)

### Task 11: Discovery job

**Files:**
- Create: `src/lib/jobs/discovery.ts`
- Create: `src/lib/jobs/discovery.test.ts`

Discovery is partially pure (grouping logic) and partially I/O (fetching + Supabase upserts). We split:
- `groupValuableCandidates(logs)` — pure, testable.
- `runDiscovery(deps)` — I/O orchestration, tested by integration only.

- [ ] **Step 1: Write the failing tests for the pure helper**

```typescript
import { describe, it, expect } from 'vitest';
import { groupValuableCandidates } from './discovery';
import type { PriceHistoryLogExtended } from '@/types/market';

function makeLog(o: Partial<PriceHistoryLogExtended>): PriceHistoryLogExtended {
  return {
    id: 0, cdkey: '', buycdkey: '', buyname: '', buff: '',
    price: 0, pricetype: 0, time: 0, time_text: '', check: 0,
    ts: 0, qty: 1, item_name: '', gross_price: 0,
    unit_price: 0, unit_gross_price: 0, currency_label: '金幣',
    ...o,
  };
}

describe('groupValuableCandidates', () => {
  it('returns empty array for empty input', () => {
    expect(groupValuableCandidates([])).toEqual([]);
  });

  it('groups by (item_name, pricetype) and includes items with median >= gold threshold', () => {
    const logs = [
      makeLog({ item_name: '偷襲密卷', pricetype: 0, unit_price: 40_000 }),
      makeLog({ item_name: '偷襲密卷', pricetype: 0, unit_price: 45_000 }),
      makeLog({ item_name: '偷襲密卷', pricetype: 0, unit_price: 50_000 }),
    ];
    const result = groupValuableCandidates(logs);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('偷襲密卷');
    expect(result[0].pricetype).toBe(0);
    expect(result[0].median).toBe(45_000);
  });

  it('includes items with median >= crystal threshold (250)', () => {
    const logs = [
      makeLog({ item_name: 'rare-thing', pricetype: 1, unit_price: 300 }),
      makeLog({ item_name: 'rare-thing', pricetype: 1, unit_price: 250 }),
    ];
    const result = groupValuableCandidates(logs);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('rare-thing');
    expect(result[0].pricetype).toBe(1);
  });

  it('excludes items below threshold in both currencies', () => {
    const logs = [
      makeLog({ item_name: 'cheap', pricetype: 0, unit_price: 100 }),
      makeLog({ item_name: 'cheap', pricetype: 0, unit_price: 200 }),
      makeLog({ item_name: 'cheap', pricetype: 1, unit_price: 5 }),
    ];
    expect(groupValuableCandidates(logs)).toHaveLength(0);
  });

  it('handles same item with both currencies as separate groups', () => {
    const logs = [
      makeLog({ item_name: 'dual', pricetype: 0, unit_price: 50_000 }),
      makeLog({ item_name: 'dual', pricetype: 0, unit_price: 60_000 }),
      makeLog({ item_name: 'dual', pricetype: 1, unit_price: 300 }),
      makeLog({ item_name: 'dual', pricetype: 1, unit_price: 350 }),
    ];
    const result = groupValuableCandidates(logs);
    expect(result).toHaveLength(2);
    expect(result.find((c) => c.pricetype === 0)?.median).toBe(55_000);
    expect(result.find((c) => c.pricetype === 1)?.median).toBe(325);
  });

  it('ignores zero unit_price entries (malformed logs)', () => {
    const logs = [
      makeLog({ item_name: 'x', pricetype: 0, unit_price: 50_000 }),
      makeLog({ item_name: 'x', pricetype: 0, unit_price: 0 }),
      makeLog({ item_name: 'x', pricetype: 0, unit_price: 50_000 }),
    ];
    const result = groupValuableCandidates(logs);
    expect(result[0].sampleSize).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm test src/lib/jobs/discovery.test.ts`
Expected: module not found.

- [ ] **Step 3: Implement discovery.ts**

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PriceHistoryLogExtended } from '@/types/market';
import type { ScanRunOutcome } from '@/types/scanner';
import { computeMedian } from '../threshold';
import { VALUABLE_GOLD_THRESHOLD, VALUABLE_CRYSTAL_THRESHOLD } from '@/types/scanner';
import { fetchMarketRecord } from '../api-clients/marketrecord';
import { deriveExchangeRate } from '../exchange-rate';

export interface ValuableCandidate {
  name: string;
  pricetype: number;
  median: number;
  sampleSize: number;
}

export function groupValuableCandidates(logs: PriceHistoryLogExtended[]): ValuableCandidate[] {
  const groups = new Map<string, number[]>();
  for (const log of logs) {
    if (!log.item_name || log.unit_price <= 0) continue;
    const key = `${log.item_name}::${log.pricetype}`;
    const arr = groups.get(key) ?? [];
    arr.push(log.unit_price);
    groups.set(key, arr);
  }

  const candidates: ValuableCandidate[] = [];
  for (const [key, prices] of groups) {
    const [name, ptStr] = key.split('::');
    const pricetype = Number(ptStr);
    const median = computeMedian(prices);
    const threshold = pricetype === 0 ? VALUABLE_GOLD_THRESHOLD : VALUABLE_CRYSTAL_THRESHOLD;
    if (median >= threshold) {
      candidates.push({ name, pricetype, median, sampleSize: prices.length });
    }
  }
  return candidates;
}

export interface DiscoveryDeps {
  supabase: SupabaseClient;
  signal: AbortSignal;
  onProgress: (update: { currentPage: number; totalPages: number; note?: string }) => void;
  pages: number;
}

export async function runDiscovery(deps: DiscoveryDeps): Promise<ScanRunOutcome> {
  let itemsScanned = 0;
  let pricesRecorded = 0;
  const allLogs: PriceHistoryLogExtended[] = [];

  try {
    for (let page = 1; page <= deps.pages; page += 1) {
      if (deps.signal.aborted) {
        return { status: 'aborted', itemsScanned, pricesRecorded, errorMessage: null };
      }
      const res = await fetchMarketRecord(
        { page, range: '7d', sort: 'time_desc', currency: 'all', type: 'all' },
        { signal: deps.signal }
      );
      allLogs.push(...res.logs);
      itemsScanned += res.logs.length;
      deps.onProgress({ currentPage: page, totalPages: deps.pages });
    }

    const candidates = groupValuableCandidates(allLogs);
    deps.onProgress({ currentPage: deps.pages, totalPages: deps.pages, note: `Found ${candidates.length} valuable candidates` });

    // Upsert items table — only inserts items not already present.
    for (const c of candidates) {
      const { data: existing } = await deps.supabase
        .from('items')
        .select('id')
        .eq('name', c.name)
        .is('item_level', null)
        .maybeSingle();
      if (existing) continue;

      const { error } = await deps.supabase.from('items').insert({
        name: c.name,
        item_type: 'item',
        is_auto_discovered: true,
      });
      if (error) {
        console.error('[discovery] insert failed:', error.message);
        continue;
      }
      pricesRecorded += 1;
      deps.onProgress({
        currentPage: deps.pages,
        totalPages: deps.pages,
        note: `Discovered: ${c.name}`,
      });
    }

    // Derive exchange rate
    const rate = deriveExchangeRate(allLogs);
    if (rate) {
      await deps.supabase.from('derived_exchange_rate').insert({
        gold_per_crystal: rate.gold_per_crystal,
        source_item_name: rate.source_item_name,
        sample_size: rate.sample_size,
        median_crystal_price: rate.median_crystal_price,
      });
      deps.onProgress({
        currentPage: deps.pages,
        totalPages: deps.pages,
        note: `Exchange rate: ${rate.gold_per_crystal.toFixed(2)} gold/crystal (n=${rate.sample_size})`,
      });
    }

    return { status: 'completed', itemsScanned, pricesRecorded, errorMessage: null };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { status: 'aborted', itemsScanned, pricesRecorded, errorMessage: null };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { status: 'failed', itemsScanned, pricesRecorded, errorMessage: msg };
  }
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm test src/lib/jobs/discovery.test.ts`
Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/jobs/discovery.ts src/lib/jobs/discovery.test.ts
git commit -m "feat: discovery scan job (find valuable items + derive exchange rate)"
```

---

### Task 12: Market sweep job

**Files:**
- Create: `src/lib/jobs/market-sweep.ts`
- Create: `src/lib/jobs/market-sweep.test.ts`

Pure helper: `filterRelevantListings(response, knownItemNames)` — returns only listings of items we care about.

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from 'vitest';
import { filterRelevantListings } from './market-sweep';
import type { MarketResponse } from '@/types/market';

function makeResponse(itemsByCd: MarketResponse['itemsByCd']): MarketResponse {
  return {
    page: 1, perPage: 20, totalFiltered: 1,
    stalls: [
      { server: 1, name: 'Stall', x: 0, y: 0, time: 0, cdkey: 'AAA_1', coords: 'x', expires: 'y' },
    ],
    itemsByCd,
  };
}

describe('filterRelevantListings', () => {
  it('returns empty when no items match', () => {
    const res = makeResponse({
      AAA_1: [{
        cdkey: 'AAA_1', price: 100, pricetype: 0, ITEM_ID: 1,
        ITEM_TRUENAME: 'unknown', ITEM_FIRSTNAME: '', ITEM_MODIFYATTACK: 0, ITEM_MODIFYDEFENCE: 0,
        ITEM_MODIFYAGILITY: 0, ITEM_MODIFYMAGIC: 0, ITEM_MAXDURABILITY: 0, ITEM_DURABILITY: 0,
        ITEM_LEVEL: 0, ITEM_BASEIMAGENUMBER: 0, ITEM_ABLEUSEFIELD: 0, ITEM_ABLEUSEBATTLE: 0,
        ITEM_CANSELL: 0, ITEM_REMAIN: 1, ITEM_MAXREMAIN: 1,
      }],
    });
    const known = new Map<string, string>(); // name -> uuid
    expect(filterRelevantListings(res, known)).toEqual([]);
  });

  it('returns listings for items in the known map', () => {
    const res = makeResponse({
      AAA_1: [{
        cdkey: 'AAA_1', price: 100, pricetype: 0, ITEM_ID: 1,
        ITEM_TRUENAME: '偷襲密卷', ITEM_FIRSTNAME: '', ITEM_MODIFYATTACK: 0, ITEM_MODIFYDEFENCE: 0,
        ITEM_MODIFYAGILITY: 0, ITEM_MODIFYMAGIC: 0, ITEM_MAXDURABILITY: 0, ITEM_DURABILITY: 0,
        ITEM_LEVEL: 0, ITEM_BASEIMAGENUMBER: 26805, ITEM_ABLEUSEFIELD: 0, ITEM_ABLEUSEBATTLE: 0,
        ITEM_CANSELL: 0, ITEM_REMAIN: 1, ITEM_MAXREMAIN: 1,
      }],
    });
    const known = new Map([['偷襲密卷::0', 'uuid-1']]);
    const result = filterRelevantListings(res, known);
    expect(result).toHaveLength(1);
    expect(result[0].item_id).toBe('uuid-1');
    expect(result[0].price).toBe(100);
    expect(result[0].pricetype).toBe(0);
    expect(result[0].stall_cdkey).toBe('AAA_1');
    expect(result[0].server).toBe(1);
  });

  it('uses item_level when matching (level 7 != level 5 of same name)', () => {
    const res = makeResponse({
      AAA_1: [{
        cdkey: 'AAA_1', price: 100, pricetype: 0, ITEM_ID: 1,
        ITEM_TRUENAME: '改造圖', ITEM_FIRSTNAME: '', ITEM_MODIFYATTACK: 0, ITEM_MODIFYDEFENCE: 0,
        ITEM_MODIFYAGILITY: 0, ITEM_MODIFYMAGIC: 0, ITEM_MAXDURABILITY: 0, ITEM_DURABILITY: 0,
        ITEM_LEVEL: 7, ITEM_BASEIMAGENUMBER: 0, ITEM_ABLEUSEFIELD: 0, ITEM_ABLEUSEBATTLE: 0,
        ITEM_CANSELL: 0, ITEM_REMAIN: 1, ITEM_MAXREMAIN: 1,
      }],
    });
    const known = new Map([['改造圖::7', 'gold-uuid']]); // only gold variant known
    const result = filterRelevantListings(res, known);
    expect(result).toHaveLength(1);
    expect(result[0].item_id).toBe('gold-uuid');
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm test src/lib/jobs/market-sweep.test.ts`
Expected: fails.

- [ ] **Step 3: Implement market-sweep.ts**

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import type { MarketResponse, MarketItem, Stall } from '@/types/market';
import type { ScanRunOutcome } from '@/types/scanner';
import { fetchMarketPage } from '../api-clients/market';
import { isGaiZaoTuLevel } from '../item-level';

export interface MarketListingRow {
  item_id: string;
  price: number;
  pricetype: number;
  server: number;
  stall_name: string;
  stall_cdkey: string;
  coords: string;
  quantity: number;
  source: 'market';
  listing_key: string;
}

// Build the lookup key consistent with how we store items
function itemLookupKey(name: string, level: number | null): string {
  // For 改造圖 levels (5/6/7), use the level. Otherwise null/'' for "no level".
  if (isGaiZaoTuLevel(level)) return `${name}::${level}`;
  return `${name}::0`;
}

export function filterRelevantListings(
  response: MarketResponse,
  knownItems: Map<string, string>  // key: itemLookupKey, value: item_id (UUID)
): MarketListingRow[] {
  const stallMap = new Map(response.stalls.map((s: Stall) => [s.cdkey, s]));
  const rows: MarketListingRow[] = [];

  for (const [cdkey, items] of Object.entries(response.itemsByCd ?? {})) {
    const stall = stallMap.get(cdkey);
    if (!stall) continue;

    for (const item of items as MarketItem[]) {
      // Only persist for "no-pricetype-distinction" matching at the listing layer.
      // Items entry in our DB is keyed by name (item-level for 改造圖).
      // So we look up name+level.
      const key = itemLookupKey(item.ITEM_TRUENAME, isGaiZaoTuLevel(item.ITEM_LEVEL) ? item.ITEM_LEVEL : null);
      const itemId = knownItems.get(key);
      if (!itemId) continue;

      rows.push({
        item_id: itemId,
        price: item.price,
        pricetype: item.pricetype,
        server: stall.server,
        stall_name: stall.name,
        stall_cdkey: cdkey,
        coords: stall.coords,
        quantity: item.ITEM_REMAIN ?? 1,
        source: 'market',
        listing_key: `${itemId}:${cdkey}:${item.price}:${item.pricetype}`,
      });
    }
  }

  return rows;
}

export interface MarketSweepDeps {
  supabase: SupabaseClient;
  signal: AbortSignal;
  onProgress: (update: { currentPage: number; totalPages: number; note?: string }) => void;
}

export async function runMarketSweep(deps: MarketSweepDeps): Promise<ScanRunOutcome> {
  let itemsScanned = 0;
  let pricesRecorded = 0;
  try {
    // 1) Build known-items lookup
    const { data: knownItems, error: itemsErr } = await deps.supabase
      .from('items')
      .select('id, name, item_level')
      .eq('is_auto_discovered', true);
    if (itemsErr) throw new Error(itemsErr.message);

    const known = new Map<string, string>();
    for (const it of knownItems ?? []) {
      const key = isGaiZaoTuLevel(it.item_level) ? `${it.name}::${it.item_level}` : `${it.name}::0`;
      known.set(key, it.id);
    }

    if (known.size === 0) {
      deps.onProgress({ currentPage: 0, totalPages: 0, note: 'No items in DB yet — run Discovery first.' });
      return { status: 'completed', itemsScanned: 0, pricesRecorded: 0, errorMessage: null };
    }

    // 2) Fetch page 1 to learn totalPages
    const first = await fetchMarketPage({ page: 1 }, { signal: deps.signal });
    const totalPages = Math.ceil(first.totalFiltered / first.perPage);
    deps.onProgress({ currentPage: 1, totalPages, note: `Sweeping ${totalPages} pages...` });

    const allRows: MarketListingRow[] = [];
    allRows.push(...filterRelevantListings(first, known));
    itemsScanned += Object.values(first.itemsByCd ?? {}).reduce((acc, arr) => acc + arr.length, 0);

    // 3) Remaining pages
    for (let page = 2; page <= totalPages; page += 1) {
      if (deps.signal.aborted) {
        return { status: 'aborted', itemsScanned, pricesRecorded, errorMessage: null };
      }
      const res = await fetchMarketPage({ page }, { signal: deps.signal });
      allRows.push(...filterRelevantListings(res, known));
      itemsScanned += Object.values(res.itemsByCd ?? {}).reduce((acc, arr) => acc + arr.length, 0);
      deps.onProgress({ currentPage: page, totalPages });
    }

    // 4) Clear prior market snapshots for touched items (fresh view)
    const touchedItemIds = Array.from(new Set(allRows.map((r) => r.item_id)));
    if (touchedItemIds.length > 0) {
      const { error: delErr } = await deps.supabase
        .from('price_snapshots')
        .delete()
        .in('item_id', touchedItemIds)
        .eq('source', 'market');
      if (delErr) console.error('[market-sweep] delete failed:', delErr.message);
    }

    // 5) Batch insert
    const BATCH_SIZE = 500;
    for (let i = 0; i < allRows.length; i += BATCH_SIZE) {
      const slice = allRows.slice(i, i + BATCH_SIZE);
      const { error } = await deps.supabase.from('price_snapshots').insert(slice);
      if (error) {
        console.error('[market-sweep] batch insert failed:', error.message);
        continue;
      }
      pricesRecorded += slice.length;
    }

    deps.onProgress({
      currentPage: totalPages,
      totalPages,
      note: `Saved ${pricesRecorded} listings across ${touchedItemIds.length} items.`,
    });

    return { status: 'completed', itemsScanned, pricesRecorded, errorMessage: null };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { status: 'aborted', itemsScanned, pricesRecorded, errorMessage: null };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { status: 'failed', itemsScanned, pricesRecorded, errorMessage: msg };
  }
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm test src/lib/jobs/market-sweep.test.ts`
Expected: all 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/jobs/market-sweep.ts src/lib/jobs/market-sweep.test.ts
git commit -m "feat: market sweep job (only saves listings of known items)"
```

---

### Task 13: Stats refresh job

**Files:**
- Create: `src/lib/jobs/stats-refresh.ts`
- Create: `src/lib/jobs/stats-refresh.test.ts`

Pure helper: `pickPerCurrencyStats(response)` — extracts gold + crystal medians from a marketrecord response. Handles the `pricetype_mixed` fallback.

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from 'vitest';
import { pickPerCurrencyStats } from './stats-refresh';
import type { MarketRecordResponseV2, PriceHistoryLogExtended } from '@/types/market';

function makeResponse(overrides: Partial<MarketRecordResponseV2>): MarketRecordResponseV2 {
  return {
    page: 1, perPage: 50, totalFiltered: 0, totalFilteredRaw: 0,
    resultsTruncated: false, range: '30d', sort: 'time_desc',
    currency: 'all', type: 'all',
    logs: [],
    stats: {
      count: 0, min: 0, max: 0, avg: 0, median: 0, trend: [],
      is_unit_price: true, pricetype_mixed: false, pricetype_single: null,
    },
    trend6m: { days: [], pricetype_single: null, start_day: '', end_day: '', chart_mode: 'daily_median_iqr' },
    ...overrides,
  };
}

function makeLog(o: Partial<PriceHistoryLogExtended>): PriceHistoryLogExtended {
  return {
    id: 0, cdkey: '', buycdkey: '', buyname: '', buff: '',
    price: 0, pricetype: 0, time: 0, time_text: '', check: 0,
    ts: 0, qty: 1, item_name: '', gross_price: 0,
    unit_price: 0, unit_gross_price: 0, currency_label: '',
    ...o,
  };
}

describe('pickPerCurrencyStats', () => {
  it('returns the server median into gold when pricetype_single=0', () => {
    const res = makeResponse({
      stats: { count: 10, min: 30_000, max: 60_000, avg: 45_000, median: 45_000, trend: [],
        is_unit_price: true, pricetype_mixed: false, pricetype_single: 0 },
    });
    const result = pickPerCurrencyStats(res);
    expect(result.gold).toEqual({ median: 45_000, min: 30_000, max: 60_000, count: 10 });
    expect(result.crystal).toBeNull();
  });

  it('returns the server median into crystal when pricetype_single=1', () => {
    const res = makeResponse({
      stats: { count: 5, min: 300, max: 400, avg: 350, median: 350, trend: [],
        is_unit_price: true, pricetype_mixed: false, pricetype_single: 1 },
    });
    const result = pickPerCurrencyStats(res);
    expect(result.crystal).toEqual({ median: 350, min: 300, max: 400, count: 5 });
    expect(result.gold).toBeNull();
  });

  it('falls back to client-side per-currency medians when pricetype_mixed=true', () => {
    const res = makeResponse({
      stats: { count: 4, min: 0, max: 0, avg: 0, median: 0, trend: [],
        is_unit_price: true, pricetype_mixed: true, pricetype_single: null },
      logs: [
        makeLog({ pricetype: 0, unit_price: 40_000 }),
        makeLog({ pricetype: 0, unit_price: 50_000 }),
        makeLog({ pricetype: 1, unit_price: 200 }),
        makeLog({ pricetype: 1, unit_price: 300 }),
      ],
    });
    const result = pickPerCurrencyStats(res);
    expect(result.gold).toEqual({ median: 45_000, min: 40_000, max: 50_000, count: 2 });
    expect(result.crystal).toEqual({ median: 250, min: 200, max: 300, count: 2 });
  });

  it('returns nulls when no usable stats', () => {
    const res = makeResponse({});
    const result = pickPerCurrencyStats(res);
    expect(result.gold).toBeNull();
    expect(result.crystal).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm test src/lib/jobs/stats-refresh.test.ts`
Expected: module not found.

- [ ] **Step 3: Implement stats-refresh.ts**

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import type { MarketRecordResponseV2 } from '@/types/market';
import type { ScanRunOutcome } from '@/types/scanner';
import { fetchMarketRecord } from '../api-clients/marketrecord';
import { computeMedian } from '../threshold';

export interface CurrencyStats {
  median: number;
  min: number;
  max: number;
  count: number;
}

export interface PerCurrencyStats {
  gold: CurrencyStats | null;
  crystal: CurrencyStats | null;
}

export function pickPerCurrencyStats(res: MarketRecordResponseV2): PerCurrencyStats {
  if (res.stats.pricetype_mixed) {
    // Mixed → compute per-currency from logs ourselves
    const goldPrices = res.logs.filter((l) => l.pricetype === 0 && l.unit_price > 0).map((l) => l.unit_price);
    const crystalPrices = res.logs.filter((l) => l.pricetype === 1 && l.unit_price > 0).map((l) => l.unit_price);

    return {
      gold: goldPrices.length > 0 ? {
        median: Math.round(computeMedian(goldPrices)),
        min: Math.min(...goldPrices),
        max: Math.max(...goldPrices),
        count: goldPrices.length,
      } : null,
      crystal: crystalPrices.length > 0 ? {
        median: Math.round(computeMedian(crystalPrices)),
        min: Math.min(...crystalPrices),
        max: Math.max(...crystalPrices),
        count: crystalPrices.length,
      } : null,
    };
  }

  if (res.stats.pricetype_single === 0) {
    return {
      gold: { median: res.stats.median, min: res.stats.min, max: res.stats.max, count: res.stats.count },
      crystal: null,
    };
  }
  if (res.stats.pricetype_single === 1) {
    return {
      gold: null,
      crystal: { median: res.stats.median, min: res.stats.min, max: res.stats.max, count: res.stats.count },
    };
  }
  return { gold: null, crystal: null };
}

export interface StatsRefreshDeps {
  supabase: SupabaseClient;
  signal: AbortSignal;
  onProgress: (update: { currentPage: number; totalPages: number; note?: string }) => void;
  scope: 'all' | 'next_n';
  nextN: number;
}

export async function runStatsRefresh(deps: StatsRefreshDeps): Promise<ScanRunOutcome> {
  let itemsScanned = 0;
  let pricesRecorded = 0;
  try {
    // Pick items, oldest refresh first
    let query = deps.supabase
      .from('items')
      .select('id, name, item_level, last_history_refresh')
      .eq('is_auto_discovered', true)
      .order('last_history_refresh', { ascending: true, nullsFirst: true });
    if (deps.scope === 'next_n') {
      query = query.limit(deps.nextN);
    }
    const { data: items, error } = await query;
    if (error) throw new Error(error.message);

    const total = items?.length ?? 0;
    if (total === 0) {
      deps.onProgress({ currentPage: 0, totalPages: 0, note: 'No items to refresh.' });
      return { status: 'completed', itemsScanned: 0, pricesRecorded: 0, errorMessage: null };
    }

    for (let i = 0; i < total; i += 1) {
      if (deps.signal.aborted) {
        return { status: 'aborted', itemsScanned, pricesRecorded, errorMessage: null };
      }
      const item = items![i];
      itemsScanned += 1;
      deps.onProgress({ currentPage: i + 1, totalPages: total, note: `Refreshing ${item.name}...` });

      // Fetch with currency=0 then currency=1. Server may ignore currency for log filter,
      // but pickPerCurrencyStats handles mixed responses too.
      const goldRes = await fetchMarketRecord(
        { page: 1, search: item.name, range: '30d', sort: 'time_desc', currency: '0' },
        { signal: deps.signal }
      );
      const crystalRes = await fetchMarketRecord(
        { page: 1, search: item.name, range: '30d', sort: 'time_desc', currency: '1' },
        { signal: deps.signal }
      );

      const goldStats = pickPerCurrencyStats(goldRes).gold;
      const crystalStats = pickPerCurrencyStats(crystalRes).crystal;
      // Use trend6m from whichever response has more data
      const trend6m = (goldRes.trend6m.days.length >= crystalRes.trend6m.days.length)
        ? goldRes.trend6m
        : crystalRes.trend6m;

      const update: Record<string, unknown> = {
        last_history_refresh: new Date().toISOString(),
        trend6m_cache: trend6m,
        trend6m_cached_at: new Date().toISOString(),
      };
      if (goldStats) {
        update.median_gold_value = goldStats.median;
        update.min_sold_gold = goldStats.min;
        update.max_sold_gold = goldStats.max;
        update.sample_count_gold = goldStats.count;
      }
      if (crystalStats) {
        update.median_crystal_value = crystalStats.median;
        update.min_sold_crystal = crystalStats.min;
        update.max_sold_crystal = crystalStats.max;
        update.sample_count_crystal = crystalStats.count;
      }

      const { error: updErr } = await deps.supabase
        .from('items')
        .update(update)
        .eq('id', item.id);
      if (updErr) {
        console.error('[stats-refresh] update failed:', updErr.message);
        continue;
      }
      pricesRecorded += 1;
    }

    return { status: 'completed', itemsScanned, pricesRecorded, errorMessage: null };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { status: 'aborted', itemsScanned, pricesRecorded, errorMessage: null };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { status: 'failed', itemsScanned, pricesRecorded, errorMessage: msg };
  }
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm test src/lib/jobs/stats-refresh.test.ts`
Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/jobs/stats-refresh.ts src/lib/jobs/stats-refresh.test.ts
git commit -m "feat: stats refresh job (cache server median + trend6m on items)"
```

---

## Phase 6: Scanner state hook

### Task 14: useScanner hook

**Files:**
- Create: `src/hooks/useScanner.ts`

This is the orchestration layer. It holds React state per job, owns the `AbortController`, and exposes start/stop functions.

- [ ] **Step 1: Implement the hook**

```typescript
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
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useScanner.ts
git commit -m "feat: useScanner orchestration hook"
```

---

## Phase 7: Scanner UI

### Task 15: ScannerJobCard component

**Files:**
- Create: `src/components/ScannerJobCard.tsx`

- [ ] **Step 1: Implement the component**

```typescript
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
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/ScannerJobCard.tsx
git commit -m "feat: ScannerJobCard component"
```

---

### Task 16: Scanner page composite

**Files:**
- Create: `src/components/Scanner.tsx`
- Create: `src/app/scanner/page.tsx`

- [ ] **Step 1: Implement the Scanner composite**

```typescript
'use client';

import { useScanner } from '@/hooks/useScanner';
import { ScannerJobCard } from '@/components/ScannerJobCard';

export function Scanner() {
  const { jobStates, start, stop, KINDS } = useScanner();

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Scanner</h2>
        <p className="text-zinc-600 dark:text-zinc-400 mt-1">
          Run scans to populate the deal-spotter database. Each scan is rate-limited (1.5–3s per request).
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {KINDS.map((kind) => (
          <ScannerJobCard
            key={kind}
            kind={kind}
            state={jobStates[kind]}
            onStart={() => start(kind)}
            onStop={() => stop(kind)}
          />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Implement the page**

`src/app/scanner/page.tsx`:

```typescript
import { Scanner } from '@/components/Scanner';

export default function ScannerPage() {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="container mx-auto py-8 px-4">
        <Scanner />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add a link from the home page**

Modify `src/app/page.tsx` — add a Link in the header next to the pet-calculator link:

```typescript
<Link href="/pet-calculator" className="inline-block mt-2 mr-4 text-sm text-blue-600 dark:text-blue-400 hover:underline">
  寵物檔位計算模擬器 →
</Link>
<Link href="/scanner" className="inline-block mt-2 text-sm text-blue-600 dark:text-blue-400 hover:underline">
  Deal Spotter Scanner →
</Link>
```

- [ ] **Step 4: Run dev server and verify**

Run: `pnpm dev`
Visit: `http://localhost:3000/scanner`
Expected:
- Three job cards visible (Discovery, Market sweep, Stats refresh).
- Each has Start button.
- Click "Start" on Discovery → status changes to "Running...", progress shows page X/Y, after ~30s status becomes "success".
- Check Supabase Studio: new rows appear in `items` (auto_discovered=true). New row in `derived_exchange_rate`.

- [ ] **Step 5: Commit**

```bash
git add src/components/Scanner.tsx src/app/scanner/page.tsx src/app/page.tsx
git commit -m "feat: scanner page wiring Discovery, Market sweep, Stats refresh"
```

---

### Task 17: End-to-end smoke test — run all three jobs

**Files:** none

- [ ] **Step 1: Run Discovery**

In the browser:
1. Open `/scanner`.
2. Click "Start" on Discovery.
3. Wait for completion (~30s for 10 pages).
4. Verify in Supabase Studio: `items` table has rows with `is_auto_discovered=true`. `derived_exchange_rate` has at least one row.

- [ ] **Step 2: Run Market sweep**

1. Click "Start" on Market sweep.
2. Wait (~3-4 min for ~108 pages).
3. Verify in Supabase Studio: `price_snapshots` table has rows with `source='market'` and `item_id` matching discovered items.

- [ ] **Step 3: Run Stats refresh**

1. Click "Start" on Stats refresh (scope: next_n = 10).
2. Wait (~30-40s for 10 items × 2 calls × ~2s).
3. Verify in Supabase Studio: at least 10 `items` rows have `median_gold_value` or `median_crystal_value` populated, plus `trend6m_cache` JSON.

- [ ] **Step 4: Verify scan_logs**

In Supabase Studio, the `scan_logs` table should have 3 new rows, all `status='completed'`, with reasonable `items_scanned` and `prices_recorded` numbers.

- [ ] **Step 5: No commit needed (verification only)**

---

## Phase 8: Image fetching

### Task 18: Discover image URL pattern (manual one-time step)

**Files:** none — this is research

- [ ] **Step 1: Open the live market page in a browser**

Visit: `https://member.starcg.net/market.php` (browser, not API).

Use search to surface some listings.

- [ ] **Step 2: Open browser devtools → Network tab → filter "Img"**

Find a request for an item icon. Note the URL pattern. Common patterns:
- `https://member.starcg.net/metamo/iconset/12345.png`
- `https://member.starcg.net/metamo/png/items/12345.gif`
- `https://member.starcg.net/.../{ITEM_BASEIMAGENUMBER}.{ext}`

Write down the exact pattern as a discovery note in `docs/superpowers/image-pattern.md`:

```markdown
# Image URL Pattern (discovered 2026-05-10)

Pattern: `<exact URL pattern with {base_image_number} substitution>`
Example: `https://member.starcg.net/...`
Extension: `.png` or `.gif`
Status: confirmed via devtools Network tab on /market.php
```

- [ ] **Step 3: Commit the discovery note**

```bash
git add docs/superpowers/image-pattern.md
git commit -m "docs: image URL pattern for item icons"
```

---

### Task 19: Image-save API route + wire into Discovery

**Files:**
- Create: `src/app/api/save-item-image/route.ts`
- Create: `public/item-images/.gitkeep`
- Modify: `.gitignore`
- Modify: `src/lib/jobs/discovery.ts` (call after item insert)

- [ ] **Step 1: Create the route**

`src/app/api/save-item-image/route.ts` — uses the URL pattern from Task 18. **Substitute the discovered pattern below** before running.

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

// REPLACE with the actual pattern discovered in Task 18.
const IMAGE_URL_PATTERN = (baseImageNumber: number) =>
  `https://member.starcg.net/metamo/iconset/${baseImageNumber}.png`;

const IMAGE_DIR = path.join(process.cwd(), 'public', 'item-images');
const IMAGE_EXT = 'png';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const baseImageNumber = Number(body?.base_image_number);
    if (!Number.isFinite(baseImageNumber) || baseImageNumber <= 0) {
      return NextResponse.json({ error: 'invalid base_image_number' }, { status: 400 });
    }

    const filename = `${baseImageNumber}.${IMAGE_EXT}`;
    const fullPath = path.join(IMAGE_DIR, filename);
    const publicPath = `/item-images/${filename}`;

    // Skip if exists
    try {
      await access(fullPath, constants.F_OK);
      return NextResponse.json({ ok: true, image_path: publicPath, cached: true });
    } catch {
      // not present, fall through
    }

    await mkdir(IMAGE_DIR, { recursive: true });
    const upstream = await fetch(IMAGE_URL_PATTERN(baseImageNumber), {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; StarCGMarketTracker/1.0)' },
    });
    if (!upstream.ok) {
      return NextResponse.json({ error: `upstream ${upstream.status}` }, { status: 502 });
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    await writeFile(fullPath, buf);

    return NextResponse.json({ ok: true, image_path: publicPath, cached: false });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
```

- [ ] **Step 2: Add `public/item-images/.gitkeep`**

```bash
mkdir -p public/item-images
touch public/item-images/.gitkeep
```

- [ ] **Step 3: Update `.gitignore`**

Append to `.gitignore`:

```
# Item images: track the .gitkeep and (optionally) committed images,
# but don't track build artifacts inside public/item-images
```

Note: by default we *do* want to commit the .png images so they ship with the repo. Leave them tracked. The .gitkeep is just a safety net for an empty folder.

- [ ] **Step 4: Wire into Discovery to fetch images for newly inserted items**

In `src/lib/jobs/discovery.ts`, after the `supabase.from('items').insert(...)` call, when the item was just inserted, look up an image for it from any matching log:

Replace the discovery item-insert block:

```typescript
      const { data: newItem, error } = await deps.supabase.from('items').insert({
        name: c.name,
        item_type: 'item',
        is_auto_discovered: true,
      }).select('id').single();
      if (error) {
        console.error('[discovery] insert failed:', error.message);
        continue;
      }
      pricesRecorded += 1;
      deps.onProgress({
        currentPage: deps.pages,
        totalPages: deps.pages,
        note: `Discovered: ${c.name}`,
      });

      // Try to find a base_image_number for this item from a recent market.php hit.
      // Note: marketrecord logs don't carry image info, so the image will be filled in
      // during the next market sweep when we see this item listed. We DO NOT fetch the
      // image here — image fetching is wired into market-sweep where we have ITEM_BASEIMAGENUMBER.
```

Then in `src/lib/jobs/market-sweep.ts`, in the `filterRelevantListings` flow, also collect a `(item_id, baseImageNumber)` set and call `/api/save-item-image` for each. Add after the batch insert block in `runMarketSweep`:

```typescript
    // 6) Fetch icons for newly known items lacking image_path
    const imageMap = new Map<string, number>(); // item_id -> baseImageNumber
    for (const [cdkey, items] of Object.entries((first as MarketResponse).itemsByCd ?? {})) {
      void cdkey;
      for (const it of items as MarketItem[]) {
        const key = isGaiZaoTuLevel(it.ITEM_LEVEL) ? `${it.ITEM_TRUENAME}::${it.ITEM_LEVEL}` : `${it.ITEM_TRUENAME}::0`;
        const itemId = known.get(key);
        if (itemId && it.ITEM_BASEIMAGENUMBER && !imageMap.has(itemId)) {
          imageMap.set(itemId, it.ITEM_BASEIMAGENUMBER);
        }
      }
    }
    // Identify items lacking image_path
    const { data: imagelessItems } = await deps.supabase
      .from('items')
      .select('id')
      .in('id', Array.from(imageMap.keys()))
      .is('image_path', null);
    for (const row of imagelessItems ?? []) {
      const num = imageMap.get(row.id);
      if (!num) continue;
      try {
        const res = await fetch('/api/save-item-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ base_image_number: num }),
        });
        const data: { ok?: boolean; image_path?: string } = await res.json();
        if (data.ok && data.image_path) {
          await deps.supabase.from('items').update({ image_path: data.image_path }).eq('id', row.id);
        }
      } catch (e) {
        console.error('[market-sweep] image fetch failed:', e);
      }
    }
```

Imports to add at the top of `market-sweep.ts`:

```typescript
import type { MarketResponse, MarketItem } from '@/types/market';
```

(The `Stall` import is already there.)

> Note: this only walks page 1 (`first`) for image discovery, which is fine — we just need one sighting per item. Full sweep already has the data we need.

- [ ] **Step 5: Run typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Run a fresh Market sweep**

In browser, on `/scanner`, click "Start" on Market sweep. Wait for completion. Verify in Supabase:
- `items` table rows now have `image_path` like `/item-images/26805.png`.
- Filesystem: `public/item-images/26805.png` (and others) exist.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/save-item-image/route.ts public/item-images/.gitkeep .gitignore src/lib/jobs/market-sweep.ts src/lib/jobs/discovery.ts public/item-images/*.png
git commit -m "feat: fetch + cache item icons in public/item-images during market sweep"
```

---

## Phase 9: Basic discovered-items view

### Task 20: DiscoveredItemsList component

**Files:**
- Create: `src/components/DiscoveredItemsList.tsx`

This is intentionally minimal — Plan 2 will produce the full leaderboard. We add it to the scanner page so the user can verify scans worked without leaving the page.

- [ ] **Step 1: Implement the component**

```typescript
'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

interface ItemRow {
  id: string;
  name: string;
  item_level: number | null;
  median_gold_value: number | null;
  median_crystal_value: number | null;
  sample_count_gold: number | null;
  sample_count_crystal: number | null;
  image_path: string | null;
  last_history_refresh: string | null;
}

export function DiscoveredItemsList() {
  const [items, setItems] = useState<ItemRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from('items')
      .select('id, name, item_level, median_gold_value, median_crystal_value, sample_count_gold, sample_count_crystal, image_path, last_history_refresh')
      .eq('is_auto_discovered', true)
      .order('median_gold_value', { ascending: false, nullsFirst: false })
      .limit(50)
      .then(({ data, error }) => {
        if (error) console.error(error);
        setItems(data ?? []);
        setLoading(false);
      });
  }, []);

  if (loading) return <div className="text-sm text-zinc-500">Loading discovered items...</div>;
  if (items.length === 0) return <div className="text-sm text-zinc-500">No items discovered yet. Run Discovery first.</div>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-zinc-500 dark:text-zinc-400 text-xs uppercase">
          <tr>
            <th className="text-left py-2">Icon</th>
            <th className="text-left py-2">Name</th>
            <th className="text-right py-2">Median (gold)</th>
            <th className="text-right py-2">Median (crystal)</th>
            <th className="text-right py-2">Samples</th>
            <th className="text-left py-2">Last refresh</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.id} className="border-t border-zinc-200 dark:border-zinc-800">
              <td className="py-2">
                {it.image_path
                  ? <img src={it.image_path} alt="" className="w-8 h-8 object-contain" />
                  : <div className="w-8 h-8 bg-zinc-200 dark:bg-zinc-800 rounded" />}
              </td>
              <td className="py-2 font-medium">
                {it.name}
                {it.item_level ? <span className="text-xs text-zinc-500 ml-1">(Lv{it.item_level})</span> : null}
              </td>
              <td className="py-2 text-right">
                {it.median_gold_value != null ? it.median_gold_value.toLocaleString() : '—'}
              </td>
              <td className="py-2 text-right">
                {it.median_crystal_value != null ? it.median_crystal_value.toLocaleString() : '—'}
              </td>
              <td className="py-2 text-right text-zinc-500">
                {(it.sample_count_gold ?? 0) + (it.sample_count_crystal ?? 0)}
              </td>
              <td className="py-2 text-zinc-500">
                {it.last_history_refresh ? new Date(it.last_history_refresh).toLocaleString() : 'never'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Mount on the scanner page**

Modify `src/components/Scanner.tsx`:

```typescript
'use client';

import { useScanner } from '@/hooks/useScanner';
import { ScannerJobCard } from '@/components/ScannerJobCard';
import { DiscoveredItemsList } from '@/components/DiscoveredItemsList';
import { Card } from '@/components/ui/card';

export function Scanner() {
  const { jobStates, start, stop, KINDS } = useScanner();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Scanner</h2>
        <p className="text-zinc-600 dark:text-zinc-400 mt-1">
          Run scans to populate the deal-spotter database. Each scan is rate-limited (1.5–3s per request).
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {KINDS.map((kind) => (
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
```

- [ ] **Step 3: Verify in browser**

Run: `pnpm dev`
Visit: `http://localhost:3000/scanner`
Expected: After running Discovery + Stats refresh, table shows discovered items sorted by gold median, with icons where available.

- [ ] **Step 4: Commit**

```bash
git add src/components/DiscoveredItemsList.tsx src/components/Scanner.tsx
git commit -m "feat: basic discovered-items list on scanner page"
```

---

### Task 21: Final smoke + build check

**Files:** none

- [ ] **Step 1: Run lint**

Run: `pnpm lint`
Expected: no errors. If warnings, fix them.

- [ ] **Step 2: Run tests**

Run: `pnpm test`
Expected: all suites pass (Tasks 5, 6, 7, 8, 11, 12, 13 — should be 30+ tests total).

- [ ] **Step 3: Run build**

Run: `pnpm build`
Expected: succeeds with no errors.

- [ ] **Step 4: End-to-end manual verification**

1. `pnpm dev`
2. Open `/scanner`
3. Run Discovery → see items appear in the table below.
4. Run Market sweep → see icons appear on items.
5. Run Stats refresh → see median values populate.
6. Refresh page → table reflects new data.

- [ ] **Step 5: Commit (only if changes were needed)**

If anything needed fixing in steps 1-3, commit fixes:

```bash
git add -A
git commit -m "chore: post-implementation cleanup"
```

---

## Self-Review Notes (post-write)

**Spec coverage check** (each requirement → task):
- ✅ Schema additions → Task 4
- ✅ Native-currency cached stats → Task 13 (Stats refresh)
- ✅ Derived exchange rate → Task 7 (lib) + Task 11 (Discovery wiring)
- ✅ Three scan jobs → Tasks 11, 12, 13
- ✅ Rate limiter with backoff + 429 handling → Task 5
- ✅ Per-job lock (single-instance) → Task 8 + Task 14 (used by hook)
- ✅ Scanner UI with monitor → Tasks 15, 16
- ✅ Image fetching → Tasks 18, 19
- ✅ `is_auto_discovered`, `trend6m_cache`, `min/max_sold_*`, etc. → Task 4
- ✅ Pre-parsed marketrecord fields (`item_name`, `qty`, `unit_price`, `stats`, `trend6m`) → Task 2 (types) + Task 13 (use)
- ✅ Basic items view for verification → Task 20

**Deferred to Plan 2** (not in scope here):
- `/items` polished leaderboard with filters
- `/items/[id]` detail page with trend6m chart and live lowest-sales fetch
- `/deals` actionable view with DEAL_THRESHOLD_PCT slider

**Risk callouts:**
1. **Image URL pattern unknown at plan-write time.** Task 18 makes the user discover it via devtools. If the pattern uses `.gif` not `.png`, update `IMAGE_EXT` in Task 19's route. If the pattern needs authentication/cookies, that's a deeper fix — note it in the discovery doc and we'll handle in implementation.
2. **`currency=0/1` filter behavior.** Test confirmed it doesn't filter logs. We assume it MAY filter `stats`. `pickPerCurrencyStats` in Task 13 handles both cases (single → use server stats; mixed → compute client-side).
3. **Rate limit headroom.** A full market sweep is ~108 pages × ~2s = ~3.5 min. Tab must stay open. If user closes tab mid-scan, the scan_logs row stays as `running` → next time they start a sweep, they'll need to manually mark it complete or wait for the lock heuristic. We rely on the in-memory lock, which is fine for single-tab use; cross-tab is not a concern for v1.
4. **Discovery doesn't pre-fetch images.** Images only appear after a Market sweep where the item is listed. Items that never appear in market won't get icons. Plan 2 may add a fallback (skip-icon-render in UI when image_path is null is already in place).

**Type consistency** (cross-task name matching):
- `ScanJobKind` used in Tasks 3, 8, 14, 15.
- `ScanRunOutcome` used in Tasks 3, 8, 11, 12, 13, 14.
- `MarketRecordResponseV2` defined in Task 2, used in Tasks 10, 13.
- `PriceHistoryLogExtended` defined in Task 2, used in Tasks 7, 11.
- All names match.

**Placeholders:** none — all steps contain runnable code or exact commands.
