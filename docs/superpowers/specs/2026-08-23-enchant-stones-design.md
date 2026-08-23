# Enchant Stones (附魔石) Deal Finder — Design

Date: 2026-08-23
Status: Approved by user

## Purpose

A dedicated page that finds 附魔石 listings priced way below their structural fair value,
so the user can snap up underpriced stones for merging.

## Fair price model

- Level N stone is made by merging two level N−1 stones (2-to-1 merge, per
  https://guide.starcg.net/production/gems).
- Fair price in crystal: `anchor × 2^(level−1)`, anchor = lv1 fair price,
  default 10 crystal, editable on the page and persisted to localStorage.
- Gold equivalent uses the app's live exchange rate (`useExchangeRate`, Supabase
  魔幣箱-derived, fallback 263 gold/crystal).
- A listing's discount = 1 − (listing gold-equivalent / fair gold value).

## Data

- `src/data/enchant-stones.ts`: all 70 stones (7 stats × 10 levels), keyed by the
  name inside 【】, each with level, stat, slot restriction (限制), and stat range.
  Source: guide.starcg.net/production/gems, cross-checked against the user's screenshot.
- `parseEnchantStoneName(name)`: extracts 【...】 from a listing name and looks it up.
  Unknown stone names are shown but excluded from ranking.

## Live data flow

- Reuse `useMarket` hook: on page mount, search `附魔石` (substring, all servers,
  道具攤位 only is unnecessary — keep 'all').
- Auto-continue `loadMore` while `hasMore`, so every page is fetched (500ms
  inter-page delay already built into the hook).

## Page & UI

- Route `/enchant-stones` (client page), linked from home page header area.
- Controls: anchor price input (crystal), min-discount slider (default 20%),
  server filter, stat filter, level filter, "show all" toggle (reveals rows at/above fair).
- Table sorted by discount desc: stone name + level badge + stat/range, listed
  price with 💰/💎, gold-equivalent, fair price (gold + crystal), % below fair,
  quantity (ITEM_REMAIN), server + coords + copy button, stall expiry.
- ≥50% below fair gets highlighted styling ("screaming deal", mirroring DealsView).
- Market price is per-unit (stacks: ITEM_REMAIN is the count; no per-stack division).

## Testing

- Vitest unit tests for the fair-price function and the name parser
  (`src/lib/enchant-fair-price.test.ts`).
- UI verified manually via dev server.

## Out of scope

- No Supabase snapshots / scanner dependency (always-live view).
- No integration into /deals (different fair-value model).
