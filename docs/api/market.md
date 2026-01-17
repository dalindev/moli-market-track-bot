# Market API Documentation

## Overview
The Market API provides access to current market stall listings in StarCG (星詠魔力).

## Endpoint
```
GET https://member.starcg.net/market.php
```

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `ajax` | string | Yes | - | Must be `"1"` to receive JSON response |
| `page` | number | No | `1` | Page number for pagination |
| `search` | string | No | `""` | Search term (Traditional Chinese) |
| `type` | string | No | `"all"` | Filter by stall type: `"all"`, `"道具攤位"` (items), `"寵物攤位"` (pets) |
| `server` | string | No | `"all"` | Filter by server: `"all"`, `"1"`, `"2"`, `"3"`, `"4"`, `"5"` |
| `exact` | string | No | `"0"` | Exact match: `"1"` for exact, `"0"` for partial (contains) |

## Response Structure

```typescript
interface MarketResponse {
  page: number;           // Current page number
  perPage: number;        // Items per page (typically 20)
  totalFiltered: number;  // Total items matching filter
  stalls: Stall[];        // Array of stall information
  itemsByCd: Record<string, MarketItem[]>;  // Items grouped by stall cdkey
  petsByCd?: Record<string, MarketPet[]>;   // Pets grouped by stall cdkey
}
```

### Stall Object
```typescript
interface Stall {
  server: number;    // Server ID: 1, 2, 3, 4, or 5
  name: string;      // Stall name (e.g., "寄售攤位")
  x: number;         // X coordinate in game
  y: number;         // Y coordinate in game
  time: number;      // Unix timestamp when stall was created
  cdkey: string;     // Unique stall identifier (format: "ABC123_N" where N is server)
  coords: string;    // Human-readable location (e.g., "法蘭城 [東:237 南:131]")
  expires: string;   // Expiration datetime (e.g., "2026-01-19 21:10:16")
}
```

### MarketItem Object (Full Structure)
```typescript
interface MarketItem {
  // Core fields
  cdkey: string;              // Stall identifier
  price: number;              // Listed price
  pricetype: number;          // 0 = 金幣 (Gold), 1 = 魔晶 (Crystal)

  // Item identification
  ITEM_ID: number;            // Unique item type ID
  ITEM_TRUENAME: string;      // Actual item name (Traditional Chinese) - USE THIS FOR DISPLAY
  ITEM_FIRSTNAME: string;     // Category hint (e.g., "宝石？", "手环？")
  ITEM_BASEIMAGENUMBER: number; // Image asset number for displaying item icon
  ITEM_UNIQUECODE: string;    // Unique instance identifier

  // Item properties
  ITEM_TYPE: number;          // Item type category
  ITEM_LEVEL: number;         // Required level to use
  ITEM_COST: number;          // Base cost value
  ITEM_REMAIN: number;        // Stack remaining
  ITEM_MAXREMAIN: number;     // Max stack size
  ITEM_DURABILITY: number;    // Current durability
  ITEM_MAXDURABILITY: number; // Maximum durability

  // Stat modifiers
  ITEM_MODIFYATTACK: number;      // Attack bonus
  ITEM_MODIFYDEFENCE: number;     // Defence bonus
  ITEM_MODIFYAGILITY: number;     // Agility bonus
  ITEM_MODIFYMAGIC: number;       // Magic bonus
  ITEM_MODIFYRECOVERY: number;    // Recovery bonus
  ITEM_MODIFYCRITICAL: number;    // Critical bonus
  ITEM_MODIFYCOUNTER: number;     // Counter bonus
  ITEM_MODIFYHITRATE: number;     // Hit rate bonus
  ITEM_MODIFYAVOID: number;       // Avoid bonus
  ITEM_MODIFYHP: number;          // HP bonus
  ITEM_MODIFYFORCEPOINT: number;  // Force point bonus
  ITEM_MODIFYLUCK: number;        // Luck bonus
  ITEM_MODIFYCHARISMA: number;    // Charisma bonus
  ITEM_MODIFYCHARM: number;       // Charm bonus
  ITEM_MODIFYSTAMINA: number;     // Stamina bonus
  ITEM_MODIFYDEX: number;         // Dexterity bonus
  ITEM_MODIFYINTELLIGENCE: number; // Intelligence bonus

  // Status effect resistances
  ITEM_POISON: number;        // Poison resistance
  ITEM_SLEEP: number;         // Sleep resistance
  ITEM_STONE: number;         // Stone resistance
  ITEM_DRUNK: number;         // Drunk resistance
  ITEM_CONFUSION: number;     // Confusion resistance
  ITEM_AMNESIA: number;       // Amnesia resistance

  // Usage flags
  ITEM_ABLEUSEFIELD: number;  // Can use in field (0/1)
  ITEM_ABLEUSEBATTLE: number; // Can use in battle (0/1)
  ITEM_CANSELL: number;       // Can be sold (0/1)
  ITEM_CANPETMAIL: number;    // Can send via pet mail (0/1)

  // Metadata
  ITEM_CREATETIME: number;    // Unix timestamp of item creation
  ITEM_MEMO: string;          // Item memo/notes
  ITEM_BUFF1: string;         // Buff description 1
  ITEM_BUFF2: string;         // Buff description 2
}
```

### MarketPet Object
```typescript
interface MarketPet {
  cdkey: string;        // Stall identifier
  price: number;        // Listed price
  pricetype: number;    // Currency: 0 = 金幣, 1 = 魔晶
  Name: string;         // Pet name (Traditional Chinese)
  Lv: number;           // Pet level
  BaseImgnum: number;   // Image asset number
}
```

## Example Request
```bash
curl -H "Accept: application/json" \
     -H "User-Agent: Mozilla/5.0 (compatible; MarketTracker/1.0)" \
     "https://member.starcg.net/market.php?ajax=1&page=1&search=%E6%AD%A6%E5%99%A8&type=%E9%81%93%E5%85%B7%E6%94%A4%E4%BD%8D&server=all&exact=0"
```

## Example Response (Real Data)
```json
{
  "page": 1,
  "perPage": 20,
  "totalFiltered": 1,
  "stalls": [
    {
      "server": 1,
      "name": "寄售攤位",
      "x": 237,
      "y": 131,
      "time": 1768828216,
      "cdkey": "PUUoN1leH8_12",
      "coords": "法蘭城 [東:237 南:131]",
      "expires": "2026-01-19 21:10:16"
    }
  ],
  "itemsByCd": {
    "PUUoN1leH8_12": [
      {
        "cdkey": "PUUoN1leH8_12",
        "price": 150,
        "pricetype": 1,
        "ITEM_ID": 18375,
        "ITEM_BASEIMAGENUMBER": 26805,
        "ITEM_TRUENAME": "流星",
        "ITEM_FIRSTNAME": "宝石？",
        "ITEM_TYPE": 38,
        "ITEM_LEVEL": 5,
        "ITEM_MODIFYATTACK": 0,
        "ITEM_MODIFYDEFENCE": 0,
        "ITEM_MAXDURABILITY": 0,
        "ITEM_DURABILITY": 0,
        "ITEM_UNIQUECODE": "1696686142i03550"
      }
    ]
  }
}
```

## Rate Limiting

**Important:** The API has undocumented rate limits. Follow these guidelines:

- **Delay between requests:** Minimum 500ms between consecutive requests
- **Max pages per search:** Limit to 3-5 pages to avoid excessive requests
- **Caching:** Results can be cached for 60 seconds (stall data updates infrequently)
- **User-Agent:** Always set a descriptive User-Agent header

## Pagination

Calculate total pages:
```typescript
const totalPages = Math.ceil(response.totalFiltered / response.perPage);
```

Typical pagination strategy:
1. Fetch page 1 to get `totalFiltered`
2. Auto-fetch pages 2-3 with 500ms delay between each
3. Stop if page >= totalPages

## Currency System

| pricetype | Currency | Symbol |
|-----------|----------|--------|
| 0 | 金幣 (Gold) | Base currency |
| 1 | 魔晶 (Crystal) | Premium currency |

Default exchange rate: 1 魔晶 ≈ 333 金幣

## Server Names

| ID | Name |
|----|------|
| 1 | S1 |
| 2 | S2 |
| 3 | S3 |
| 4 | S4 |
| 5 | S5 |

## Key Fields for Tracking

When saving items to database, focus on these key fields:
- `ITEM_TRUENAME` - The actual display name (use for matching/tracking)
- `ITEM_ID` - Unique item type identifier
- `ITEM_BASEIMAGENUMBER` - For displaying item icons
- `price` / `pricetype` - Current listing price
- `stall.server` - Which server the item is on
- `stall.coords` - Location for in-game navigation
