# Deal Spotter — Design Spec

**Status:** Approved, ready for implementation planning
**Date:** 2026-05-10
**Last updated:** 2026-05-10 (API re-probe revealed expanded `marketrecord.php` response → simplified architecture)
**Scope:** Items only. Pets deferred to a later spec.

## API Version Note (2026-05-10)

The live `marketrecord.php` endpoint returns more than the project docs describe:

- **New top-level fields:** `stats` (count/min/max/avg/median/trend/pricetype_mixed/pricetype_single), `trend6m` (6-month daily aggregates with IQR-based outlier counts), `totalFilteredRaw`, `resultsTruncated`, echoed-back `range`/`sort`/`currency`/`type`.
- **New per-log fields:** `item_name`, `qty`, `unit_price`, `gross_price`, `unit_gross_price`, `ts`, `currency_label` — pre-parsed, no `buff` regex needed.
- **`perPage = 50`** on this endpoint (vs 20 on `market.php`).
- `chart_mode: "daily_median_iqr"` — the server applies its own IQR-based outlier filtering for the trend.

`market.php` structure unchanged from project docs.

This design relies on the new fields. See "Implementation note" callouts below.

## Goal

Find profit-making opportunities by spotting current market listings of **high-value items** priced significantly below their historical fair value. "High-value" = median historical sale ≥ 40,000 gold OR ≥ 250 crystal (OR-gate, native currency).

Two surfaces of value:
1. **Live deals** — current `market.php` listings way below fair value. Actionable now.
2. **Past misprices** — completed sales in `marketrecord.php` history that went way below fair value. Educational — surfaces which items get mispriced often, calibrates what "way below" actually means in practice.

## Non-Goals

- Pets (later spec; data model leaves room).
- Stat-rolled gear scoring. The high-value threshold naturally excludes most random-stat gear, and historical records don't preserve stat info anyway. If a stat-rolled item happens to qualify, the user judges manually from the displayed stats.
- Cross-server arbitrage. Listings are server-scoped; the deal view shows server per listing but doesn't compute transfer profit.
- Real-time push notifications. The user opens the app, sees deals, acts.

## Architectural Decisions

### Where it runs
Scans run **client-side in the browser**, triggered from a `/scanner` page in the existing Next.js app. The browser fetches via the existing `/api/market` and `/api/marketrecord` proxy routes, parses, batches, and writes to Supabase via `@supabase/supabase-js`.

**Rationale:** Vercel API routes have a 60s timeout (hobby plan) that breaks long scans. Supabase Edge Functions work but add deployment complexity. The user explicitly wants visible control and a monitor in the page. Client-side gives instant feedback, free cancellation on tab close, and uses existing infrastructure with zero new hosting.

### Storage stance
**Only items meeting the high-value threshold** are stored. Discovery scans transactions widely, but only items whose median sale clears the threshold get a row in `items`.

**Transaction records are NOT persisted.** The API's per-item `stats` object (median/min/max/count) and `trend6m` (6-month daily chart) replace what we previously planned to compute from stored snapshots. For each tracked item we cache:
- Server-computed `stats.median`, `stats.min`, `stats.max`, `stats.count` per currency, on the `items` row.
- `trend6m` JSON on the `items` row with a refresh timestamp.

For "show me the actual lowest sales" / misprice detail views, we fetch live (`?sort=price_asc&range=30d`) instead of querying stored rows. Rate-limited like any other call.

**Current market listings ARE persisted** in `price_snapshots(source='market')`, refreshed each market sweep, so the `/deals` view does a fast SQL join instead of N live calls.

Items dropping below threshold aren't deleted, just stop getting refreshed. Manual cleanup if needed.

### Currency strategy
**Native currency at storage time.** `price_snapshots` keeps the original `price` and `pricetype` (0=gold, 1=crystal). Conversion happens at query/display time using a **live derived rate** from recent `魔幣箱（100萬）` transactions: `gold_per_crystal = 1,000,000 / median(crystal_price_of_recent_100w_box_sales)`. This rate is recomputed on every discovery scan and stored in a new `derived_exchange_rate` table.

### Item identity
Items are unique by `(name, item_level)`. The existing schema's `item_level` column already separates 普通 / 銀 / 金 改造圖 variants. Same pattern applies to any other items where level distinguishes value.

### Fair value calculation
**Fair value comes from the API's server-computed `stats.median`** (returned by `marketrecord.php` when searching by item name). We cache it per currency on the `items` row (`median_gold_value`, `median_crystal_value`). The 6-month daily trend (`trend6m` from the same response) is also cached for charting.

The existing `update_price_statistics()` plpgsql function is **only kept for legacy compat** — items also present in the legacy `tracked_items` table still get a stats refresh via that function so the existing tracked-items UI keeps working. New auto-discovered items don't use it.

## Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                       /scanner page (browser)                    │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ Discovery    │  │ Market sweep │  │ Stats refresh        │  │
│  │ (manual)     │  │ (manual)     │  │ (manual, rotates)    │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘  │
└─────────┼─────────────────┼─────────────────────┼──────────────┘
          │                 │                     │
          │ /api/marketrec  │ /api/market         │ /api/marketrecord
          │ (unfiltered)    │ (page 1..N)         │ (per-item search)
          ▼                 ▼                     ▼
   ┌────────────────────────────────────────────────────┐
   │             member.starcg.net (proxied)            │
   └────────────────────────────────────────────────────┘
          │                 │                     │
          │ insert new      │ refresh             │ pull stats +
          │ items only      │ market snapshots    │ trend6m, cache on item row
          ▼                 ▼                     ▼
   ┌─────────────────────────────────────────────────────────┐
   │                      Supabase                            │
   │                                                          │
   │  items (median_*_value, min/max_sold_*, trend6m_cache)   │
   │    ├── price_snapshots (source='market')   ← only this   │
   │    │                                                     │
   │  derived_exchange_rate (from 魔幣箱 transactions)         │
   └─────────────────────────────────────────────────────────┘
          │                                       ▲
          ▼                                       │ live fetch for
       /deals          /items              /items/[id]
       (live join)   (leaderboard)         lowest-sales table
```

## Three Scan Jobs

All jobs share these rules:
- **Inter-request delay:** uniform random 1500–3000 ms.
- **On 429:** honor `Retry-After` header if present; else 30s + jitter. Up to 3 retries.
- **On 5xx/network error:** exponential backoff (5s, 15s, 45s).
- **Circuit breaker:** 3 consecutive failures → abort job, log to `scan_logs.status='failed'`, set a `paused_until` timestamp on the job state for 1 hour. Subsequent attempts before that time refuse to start.
- **Single-instance lock:** before starting, look for a `scan_logs` row of the same `scan_type` with `status='running'` and `started_at < 30 min ago`. If found, refuse to start (covers stalled tab).
- **Abort:** scan loop checks an `AbortController.signal` between every page fetch and every batch save. "Stop" button aborts cleanly.

### Job A: Discovery scan
- **Endpoint:** `GET /api/marketrecord?ajax=1&page=N&type=all&range=7d&currency=all&sort=time_desc&search=`
- **Empty `search`** → most-recent transactions across all items. `perPage=50`.
- **Pages:** 10 by default (configurable). 500 transactions per run.
- **Process:**
  1. Read pre-parsed fields from each log: `item_name`, `qty`, `unit_price`, `pricetype`, `ts`. *(No `buff` regex.)*
  2. Group by `(item_name, pricetype)`. Compute median `unit_price` per group (client-side, since the broad scan response's `stats` is across all items, not per-item).
  3. For each group where median ≥ 40k (gold) or ≥ 250 (crystal):
     - **If item not yet in `items`**: insert with `is_auto_discovered=true`, set name + item_type='item'. Leave `median_*_value` null; Job C will fill them properly with the server-computed median.
     - **If already in `items`**: no-op here (Job C will refresh stats).
  4. Drop the rest.
  5. After all pages: derive new exchange rate from `魔幣箱（100萬）` transactions in this same dataset; insert into `derived_exchange_rate`.

> **Implementation note:** This client-side median is only used for the *threshold gate* (is this item valuable enough to track?). The authoritative reference price comes from Job C using `response.stats.median`, which uses the server's full dataset.

### Job B: Market sweep
- **Endpoint:** `GET /api/market?ajax=1&page=N&search=&type=all&server=all&exact=0`
- **Pages:** all (`Math.ceil(totalFiltered / perPage)`, typically ~108).
- **Process:**
  1. For each stall, for each item: check if item exists in `items` (by name + item_level).
  2. If yes: collect `{item_id, price, pricetype, server, stall_name, stall_cdkey, coords, quantity, source='market'}`.
  3. If no: skip.
  4. Before batch-inserting collected snapshots, delete prior `source='market'` rows for those item_ids (so "current market" is always a fresh view).
  5. Batch insert (~500 rows per Supabase call).
  6. No stats recompute here — market sweeps don't touch transaction history, and the new feature's reference price (`items.median_*_value`) comes from `update_native_currency_stats` which only reads `source='transaction'` rows.

### Job C: Stats refresh (formerly "History deepening")
- Goal: for each item in `items`, pull the server-computed `stats` and `trend6m` and cache them on the item row.
- **Per-item, two calls:**
  1. `?search=<name>&type=all&range=30d&currency=0&sort=time_desc&perPage=50&page=1` → response's `stats` block is for **gold transactions** (or all transactions if the server ignores `currency`; see Open Questions). Read `stats.median`, `stats.min`, `stats.max`, `stats.count` → `median_gold_value`, `min_sold_gold`, sample_count_gold etc. Also capture `trend6m` JSON in this response.
  2. `?search=<name>&type=all&range=30d&currency=1&sort=time_desc&perPage=50&page=1` → same for crystal → `median_crystal_value`, `min_sold_crystal`, `sample_count_crystal`.
- **Fallback if `currency` param is ignored by the server:** use `stats.pricetype_single` / `pricetype_mixed`. If `pricetype_single` is set, the stats are unambiguous and only one of (median_gold_value, median_crystal_value) is populated. If `pricetype_mixed=true`, we client-side filter the returned logs by `pricetype`, compute the median of `unit_price` within each currency, and use those.
- Persist `trend6m` JSON to `items.trend6m_cache`, set `items.trend6m_cached_at = NOW()`.
- Update `items.last_history_refresh = NOW()`.
- **Legacy compat:** if the item also appears in the legacy `tracked_items` table, also call existing `update_price_statistics(item_id)` so the legacy tracked-items UI keeps working (it reads from `price_statistics`).
- **Rotation:** items sorted by `last_history_refresh ASC NULLS FIRST` so stale ones go first. User can choose "all items" (long) or "next 10" (~3.5 min).

> **Implementation note:** We don't insert any transaction rows into `price_snapshots`. The `stats` and `trend6m` data on the item row replace the need for per-transaction storage.
- **Rotation:** items sorted by `last_history_refresh ASC NULLS FIRST` so stale ones go first. User can choose "all items" (long) or "next 10" (~3.5 min).

## Rate Limiting & Anti-Ban Details

| Concern | Mitigation |
|---|---|
| Burst requests | Strict serial, single `await` chain, never `Promise.all` for fetches |
| Detectable bot pattern | Random 1.5–3s jitter, also jitter the user's perception of "every 15 min" if we add a scheduler later |
| 429 storms | Circuit breaker pauses 1h after 3 failures |
| Stalled tabs | Single-instance lock via `scan_logs` |
| User-Agent diversity | Single consistent UA: `Mozilla/5.0 (compatible; StarCGMarketTracker/1.0)` — honest about identity |
| Image fetching adds load | Lazy: fetch image only when an item is first persisted, cached forever |

## Image Fetching

**Open question:** the live image URL pattern on `member.starcg.net` is not yet known — the market page is JS-rendered and the static HTML doesn't reveal it. Codebase only stores `ITEM_BASEIMAGENUMBER` without ever rendering.

**Plan:**
1. **Discovery during implementation:** open the live market page in a browser, inspect network requests for `<img>` loads of item icons. Record the URL pattern (likely something like `https://member.starcg.net/metamo/icons/<base_image_number>.png` based on the `/metamo/png/` directory we already found via the static fetch).
2. **Once pattern known:** add a Next.js API route `POST /api/save-item-image` that takes a `base_image_number`, fetches the remote image, and writes to `public/item-images/<base_image_number>.<ext>`. Returns the local path. Idempotent (skip if file exists).
3. **Trigger:** scanner calls this route opportunistically when persisting a new item, or in a batch after a market sweep for any item without `image_path`.
4. **Storage:** `public/item-images/` is a tracked directory. Images committed to repo. In production, the dev pre-runs a scan so images are present. Future: optionally upgrade to Supabase Storage if repo size becomes annoying.
5. **UI fallback:** if `image_path` is null on an item, render a placeholder.

**Constraint:** image fetches use the same rate limiter as market scans. No parallel image downloads.

## Data Model Additions

```sql
-- Extend items
ALTER TABLE items ADD COLUMN IF NOT EXISTS is_auto_discovered BOOLEAN DEFAULT FALSE;
ALTER TABLE items ADD COLUMN IF NOT EXISTS median_gold_value INTEGER;          -- server's stats.median, gold transactions
ALTER TABLE items ADD COLUMN IF NOT EXISTS median_crystal_value INTEGER;       -- server's stats.median, crystal transactions
ALTER TABLE items ADD COLUMN IF NOT EXISTS min_sold_gold INTEGER;              -- server's stats.min, gold
ALTER TABLE items ADD COLUMN IF NOT EXISTS min_sold_crystal INTEGER;           -- server's stats.min, crystal
ALTER TABLE items ADD COLUMN IF NOT EXISTS max_sold_gold INTEGER;              -- server's stats.max, gold (useful for "ceiling" UX)
ALTER TABLE items ADD COLUMN IF NOT EXISTS max_sold_crystal INTEGER;           -- server's stats.max, crystal
ALTER TABLE items ADD COLUMN IF NOT EXISTS sample_count_gold INTEGER DEFAULT 0;
ALTER TABLE items ADD COLUMN IF NOT EXISTS sample_count_crystal INTEGER DEFAULT 0;
ALTER TABLE items ADD COLUMN IF NOT EXISTS image_path TEXT;                    -- "/item-images/26805.png" or null
ALTER TABLE items ADD COLUMN IF NOT EXISTS last_history_refresh TIMESTAMPTZ;
ALTER TABLE items ADD COLUMN IF NOT EXISTS trend6m_cache JSONB;                -- cached response.trend6m from last refresh
ALTER TABLE items ADD COLUMN IF NOT EXISTS trend6m_cached_at TIMESTAMPTZ;

-- Live exchange rate derived from 魔幣箱 transactions
CREATE TABLE IF NOT EXISTS derived_exchange_rate (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gold_per_crystal NUMERIC(10,2) NOT NULL,
  source_item_name TEXT NOT NULL,           -- '魔幣箱（100萬）' (or '10萬' as fallback)
  sample_size INTEGER NOT NULL,
  median_crystal_price INTEGER NOT NULL,
  computed_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_derived_exchange_rate_computed_at ON derived_exchange_rate(computed_at DESC);

ALTER TABLE derived_exchange_rate ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to derived_exchange_rate" ON derived_exchange_rate FOR ALL USING (true) WITH CHECK (true);
GRANT ALL ON derived_exchange_rate TO anon, authenticated, service_role;
```

**What we are NOT adding** (and why):
- ~~`update_native_currency_stats()` plpgsql function~~ — the server now returns the median in `response.stats.median`. We cache it directly. No SQL aggregation needed.
- ~~`price_snapshots(source='transaction')` rows for auto-discovered items~~ — we don't persist transaction records. `stats` + `trend6m_cache` on the item row replace this need. Existing transaction rows from the legacy tracked-items feature are left alone.

## UI Pages

### `/scanner` — control + monitor

Three job cards stacked. Each card:
- **Header**: job name, last-run timestamp, last-run outcome (success/failed/aborted).
- **Buttons**: "Start" / "Stop". Disabled appropriately based on state.
- **Live ticker** (when running): current page X of Y, items found this run, errors this run, latest item discovered, ~ETA, derived exchange rate (if discovery).
- **Settings**: discovery pages (default 10), history-deepen scope (`all items` vs `next 10`).

Below the cards:
- **Recent scan_logs table** (last 20 rows, all jobs).
- **Circuit breaker status** — if paused, shows pause-until time and a "Resume now" button.

State held in a single React hook (`useScanner`) with one `AbortController` per job. Job loops are pure async functions, fetch → parse → batch upsert.

### `/items` — leaderboard

Default view: `is_auto_discovered=true` items, sorted by **fair value in gold equivalent** (using `derived_exchange_rate` to fold crystal value into gold for ranking).

Columns:
- Icon (`image_path`) — placeholder if null
- Name + item_level badge
- Fair gold value
- Fair crystal value
- Lowest historical sale (gold and crystal columns)
- Sample count (gold/crystal)
- Currently listed? Badge with count if any `source='market'` snapshots exist
- "Live deal?" badge if any current listing is ≥ `DEAL_THRESHOLD_PCT` (default 30%) below fair value

Filters: min fair value, item level, has-current-listings, has-live-deal-only.

### `/items/[id]` — item detail

- Top: icon, name + item_level, fair values (gold + crystal), last history refresh time.
- Two sections side by side:
  - **Current market listings** — `source='market'` snapshots for this item, sorted by gold-equivalent price ascending. Shows price, currency, server, coords, % below fair value, recorded-at. "Refresh now" button triggers a single-item market check.
  - **6-month trend chart** — rendered from `items.trend6m_cache` JSON (daily median, IQR band, server's outlier flags). Horizontal "fair value" line overlaid. Days with `lo_out > 0` get a small marker — those are days the server detected low-price outliers (i.e., past misprices).
- Bottom: **lowest historical sales** — fetched live on page load via `?search=<name>&range=30d&sort=price_asc&perPage=50`. Sortable table. Misprices surface at the top by definition.

### `/deals` — the actionable view

Joins live `source='market'` snapshots ⨯ items.median_*_value, filtered to listings ≥ **`DEAL_THRESHOLD_PCT` below fair value** (in gold equivalent using `derived_exchange_rate`). Default `DEAL_THRESHOLD_PCT = 30`. Exposed as a slider on the page (10–80%) so the user can widen or tighten the funnel.

**Comparison method** (per listing):
1. Convert listing to gold: `listed_price_gold = pricetype == 1 ? price * derived_exchange_rate : price`.
2. Compute item fair value in gold: prefer `median_gold_value` if `sample_count_gold ≥ 5`; else fall back to `median_crystal_value * derived_exchange_rate` if `sample_count_crystal ≥ 5`; else exclude item from deals (not enough data).
3. `pct_below = (fair_value_gold - listed_price_gold) / fair_value_gold * 100`.
4. Include if `pct_below ≥ DEAL_THRESHOLD_PCT`.

Columns:
- Item icon + name
- Listed price + currency
- Fair value (in same currency as listing for easy mental math)
- % below fair value
- Absolute profit potential (`fair_value_gold - listed_price_gold`)
- Server + coords
- Listed-at (recorded_at)

Default sort: absolute profit potential descending. Clicking the row opens `/items/[id]`.

This page is the primary value of the project. Should be the default landing page once the database has bootstrap data.

## Open Questions (to resolve in implementation, not blockers)

1. **Image URL pattern** — discover via browser devtools on first run.
2. **Discovery pages default** — 10 is a guess; tune after first runs of how many new valuable items appear per page.
3. **History deepen rotation cadence** — once per item per day is the target; whether the user runs it manually each day or we add a scheduler is a UI follow-up.
4. **Server filter on deals page** — should the user be able to filter by their server? Defer until they ask.
5. **Does `currency=0/1` filter the `stats` object?** Earlier probe showed it didn't filter `logs[]`, but we didn't check whether the `stats` block was filtered. Test on the first run of Job C: send `currency=0` and inspect `pricetype_single` in response. If `stats` is filtered → clean per-currency reads. If not → use the fallback in Job C (read `pricetype_single`/`pricetype_mixed` flags, filter client-side from logs if mixed).
6. **`trend6m_cache` TTL** — refresh on every Job C run is simplest. If we add a scheduler later, may want to expire after 24h. Default behavior for v1: only refreshed when Job C runs for that item.

## Success Criteria

After implementation, the user should be able to:
1. Open the app, click "Start discovery" → see new valuable items appear in the items table within ~30s.
2. Click "Start market sweep" → see current listings populate within ~4 min.
3. Open `/deals` → see a ranked list of current listings that are ≥30% below fair value, with clickable server coordinates.
4. Open `/items` → browse a leaderboard of valuable items sorted by fair value.
5. Open `/items/[id]` for any item → see its server-computed fair value, a 6-month chart from cached `trend6m`, and markers on days the server flagged low-price outliers.
6. Run scans repeatedly without getting banned by the upstream API.
