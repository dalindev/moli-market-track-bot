# Market Transaction History API Documentation

## Overview
The Market Record API provides access to historical transaction data (completed purchases) in StarCG (星詠魔力).

## Endpoint
```
GET https://member.starcg.net/marketrecord.php
```

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `ajax` | string | Yes | - | Must be `"1"` to receive JSON response |
| `page` | number | No | `1` | Page number for pagination |
| `search` | string | No | `""` | Search term (Traditional Chinese) |
| `type` | string | No | `"all"` | Filter by type: `"all"`, `"item"`, `"pet"` |

## Response Structure

```typescript
interface PriceHistoryResponseRaw {
  page: number;           // Current page number
  perPage: number;        // Records per page (typically 20)
  totalFiltered: number;  // Total records matching filter
  logs: PriceHistoryLogRaw[];  // Array of transaction logs
}
```

### PriceHistoryLogRaw Object
```typescript
interface PriceHistoryLogRaw {
  id: number;           // Unique transaction ID
  cdkey: string;        // Seller's cdkey
  buycdkey: string;     // Buyer's cdkey
  buyname: string;      // Buyer's display name
  buff: string;         // Transaction description (see format below)
  price: number;        // Total transaction price
  pricetype: number;    // Currency: 0 = 金幣, 1 = 魔晶
  time: number;         // Unix timestamp of transaction
  time_text: string;    // Formatted datetime string
  check: number;        // Verification flag
}
```

## Buff Format Parsing

The `buff` field contains transaction details in a specific format:

### Items
```
購買{quantity}個：{itemName}
```
Example: `購買1個：聖誕麋鹿` → 1x 聖誕麋鹿

### Pets
```
購買{quantity}隻：{petName}
```
Example: `購買1隻：聖誕麋鹿雪橇` → 1x 聖誕麋鹿雪橇 (pet)

### Parsing Logic
```typescript
function parseLog(raw: PriceHistoryLogRaw) {
  const buff = raw.buff || '';

  // Determine type: 隻 = pet, 個 = item
  const isPet = buff.includes('隻');

  // Extract item name (after colon ：)
  const colonIndex = buff.indexOf('：');
  const itemName = colonIndex !== -1
    ? buff.substring(colonIndex + 1).trim()
    : buff;

  // Extract quantity (number after 購買)
  const quantityMatch = buff.match(/購買(\d+)/);
  const quantity = quantityMatch ? parseInt(quantityMatch[1], 10) : 1;

  // Calculate unit price
  const unitPrice = quantity > 0
    ? Math.round(raw.price / quantity)
    : raw.price;

  return {
    name: itemName,
    quantity,
    price: raw.price,      // Total price
    unitPrice,             // Price per unit
    type: isPet ? 'pet' : 'item',
    time: new Date(raw.time * 1000).toISOString(),
  };
}
```

## Example Request
```bash
curl "https://member.starcg.net/marketrecord.php?ajax=1&page=1&search=聖誕麋鹿&type=all"
```

## Example Response (Real Data)
```json
{
  "page": 1,
  "perPage": 20,
  "totalFiltered": 1344182,
  "logs": [
    {
      "id": 5770782,
      "cdkey": "9ItLH3aOc8_13",
      "buycdkey": "z111111_1",
      "buyname": "隔壁の老小姐",
      "buff": "購買1個：一箱壽喜鍋",
      "price": 33750,
      "pricetype": 0,
      "time": 1768620244,
      "check": 0,
      "time_text": "2026-01-17 11:24:04"
    },
    {
      "id": 5770777,
      "cdkey": "aW6hOEkk1p_15",
      "buycdkey": "9YxZI1xGhj_11",
      "buyname": "阿麥麥",
      "buff": "購買1個：偷襲密卷",
      "price": 53100,
      "pricetype": 0,
      "time": 1768620148,
      "check": 0,
      "time_text": "2026-01-17 11:22:28"
    },
    {
      "id": 5770776,
      "cdkey": "5P9BsetxKI_11",
      "buycdkey": "sX9oAQBm5Y_12",
      "buyname": "小火龍の噴火龍",
      "buff": "購買1個：鈎爪斧",
      "price": 2250,
      "pricetype": 0,
      "time": 1768620126,
      "check": 0,
      "time_text": "2026-01-17 11:22:06"
    }
  ]
}
```

**Note:** The `totalFiltered` of 1.3M+ shows this is a large dataset. Only fetch recent pages for monitoring.

## Rate Limiting

**Important:** The API has undocumented rate limits. Follow these guidelines:

- **Delay between requests:** Minimum 500ms between consecutive requests
- **Max pages per search:** Limit to 5 pages (~100 records) to avoid excessive requests
- **Caching:** Results can be cached for 5 minutes (historical data doesn't change)
- **User-Agent:** Set a descriptive User-Agent header

## Pagination

Calculate total pages:
```typescript
const totalPages = Math.ceil(response.totalFiltered / response.perPage);
```

Recommended strategy:
1. Fetch page 1 to get `totalFiltered`
2. Fetch up to 5 pages with 500ms delay between each
3. This typically provides ~100 recent transactions

## Currency System

| pricetype | Currency | Symbol |
|-----------|----------|--------|
| 0 | 金幣 (Gold) | Base currency |
| 1 | 魔晶 (Crystal) | Premium currency |

Default exchange rate: 1 魔晶 ≈ 333 金幣

## Use Cases

1. **Price History Charts:** Track price trends over time for specific items
2. **Average Price Calculation:** Calculate mean/median prices from recent transactions
3. **Market Analysis:** Identify price patterns and fluctuations
4. **Alert Systems:** Compare current listings against historical averages

## Notes

- Transaction history shows completed sales only (not current listings)
- Data is useful for calculating average market prices over time
- Combine with Market API to compare current prices vs historical averages

---

## Verified contract (re-measured 2026-09-12)

Everything below was confirmed against the live endpoint on 2026-09-12. Where it contradicts the
older sections above, this section wins.

### Full parameter set

| Parameter | Values | Notes |
|-----------|--------|-------|
| `ajax` | `1` | Required for JSON |
| `page` | number | `perPage` is **50** (not 20). Upstream caps at `maxPages: 10000` |
| `search` | string | Traditional Chinese |
| `type` | `all` \| `item` \| `pet` | |
| `range` | `7d` \| `30d` \| `90d` \| `all` | **`1d` and `6m` return HTTP 400 `invalid_query`.** `all` is slow (~21s) and returns the same rows as `90d` — don't use it |
| `currency` | `all` \| **`gold`** \| **`gem`** | **Not `0`/`1`** — those return HTTP 400 `invalid_query` |
| `sort` | `time_desc` \| `time_asc` \| `price_asc` \| `price_desc` | |

### Item names come back bracketed

A search for `偷襲密卷` returns `item_name: "[偷襲密卷]"` and `buff: "購買1個：[偷襲密卷]"`, while
`market.php` reports the same item as `ITEM_TRUENAME: "偷襲密卷"`. The unbracketed form is also echoed
in the response's `highlight_terms`.

**Anything that stores an item name from this endpoint must strip the OUTER wrap first** — and only
the outer wrap. Some real item names legitimately begin with a bracket: `market.php` itself returns
`ITEM_TRUENAME: "[螳螂]升星普卡"`. Such an item comes back from `marketrecord.php` doubly bracketed as
`[[螳螂]升星普卡]`. Strip one balanced outer `[...]`, never every bracket.

Production holds 390 `items` rows whose name starts with `[`; **all 390 are genuine game names**
(zero are fully wrapped in `[...]`) and must not be deleted or rewritten. The bug in
`src/lib/jobs/discovery.ts`, which stores `log.item_name` verbatim, is *prospective*: its next run
would insert wrapped rows like `[水龍蜥]` that could never match a listing.

### `search` with brackets is near-exact — use it

`search=聖誕麋鹿` matches by substring and returns 15 rows mixing three different items
(`[聖誕麋鹿雪橇]`, `[聖誕麋鹿]`, `[聖誕麋鹿韁繩]`). `search=[聖誕麋鹿]` returns only the 5 rows for that exact
item. This kills reference-price contamination in the query rather than after the fact. It is not
perfectly exact — `search=[熔岩蝙蝠]` still pulls in `[[熔岩蝙蝠]升星金卡]` — so a client-side
`item_name` filter is still required.

### `price` is net of tax; `gross_price` is what the buyer paid

The upstream's own client computes gross from net as `Math.ceil(net / (1 - taxRate))` with:

| pricetype | Currency | Tax |
|-----------|----------|-----|
| 0 | 金幣 | **10%** |
| 1 | 魔晶 | **6%** |

So `price`/`unit_price` are the **seller's proceeds**, and `gross_price`/`unit_gross_price` are the
**listed price a buyer pays** — the figure directly comparable to a `market.php` listing. Building
fair value from `unit_price` understates it by 10% (gold) or 6% (crystal).

### `stats` is meaningless while `pricetype_mixed` is true

`stats` = `{count, min, max, avg, median, trend[], is_unit_price, pricetype_mixed, pricetype_single}`.
With `currency=all` on an item that trades in both currencies, `pricetype_mixed: true` and the
median is computed across gold and crystal prices **mixed together** (e.g. `min: 47` crystal next to
`max: 108000` gold). Query `currency=gold` and `currency=gem` separately to get
`pricetype_mixed: false` and a usable per-currency median.

### `trend6m` is a ready-made outlier-trimmed daily series

`trend6m.days[]` = `{day, avg, min, max, raw_min, raw_max, cnt, hi_out, lo_out}`. Per the upstream's
own code comment, the backend has already converted these to quartiles:

- `avg` = that day's **median**
- `min` = **Q1**, `max` = **Q3**
- `raw_min` / `raw_max` = the untrimmed extremes
- `hi_out` / `lo_out` = how many high/low outliers were excluded
- `cnt` = sample count for the day

This is exactly the "normal price with extremes removed" signal we want, computed upstream for free.

### Worked example — deriving the gold↔crystal rate

`魔幣箱（100萬）` is a consumable worth exactly 1,000,000 金幣, so its crystal price fixes the rate.
Measured 2026-09-12, `range=30d&currency=gem` (`count: 2244`, `pricetype_single: 1`):

- median **net** = 2,997 魔晶 ⇒ 1,000,000 / 2,997 = **≈334 金幣 per 魔晶**
- median gross = 3,189 魔晶 ⇒ ≈314 金幣 per 魔晶

This matches the ~330 rate in use. The `exchange_rates` table in production still holds a single row
from 2026-01-17 at **263.16**, which is why crystal listings were being valued ~25% too low.

### Error envelopes

Identical to `market.php` — see that document. `400 invalid_query`, `429 rate_limited`,
`503 service_busy`, each with `retry_after` **in the body, not a header**.
