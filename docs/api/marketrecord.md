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
