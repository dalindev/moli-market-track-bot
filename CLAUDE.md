# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

StarCG Market Tracker - A Next.js application for tracking market stall prices from the StarCG (星詠魔力) online game. Users can search current market listings, view transaction history with price charts, and track specific items with price alerts.

## Development Commands

```bash
pnpm dev      # Start development server
pnpm build    # Production build
pnpm lint     # Run ESLint
```

## Architecture

### Data Flow

The app proxies external StarCG APIs through Next.js API routes to avoid CORS issues:
- `/api/market` → `member.starcg.net/market.php` (current listings, 60s cache)
- `/api/marketrecord` → `member.starcg.net/marketrecord.php` (transaction history, 5min cache)

### Key Hooks

- **useMarket** ([src/hooks/useMarket.ts](src/hooks/useMarket.ts)) - Search market listings with pagination. Auto-fetches first 5 pages, supports "load more". Returns items split into `matchingItems` and `otherItems` (items in matching stalls but not matching search).

- **usePriceHistory** ([src/hooks/usePriceHistory.ts](src/hooks/usePriceHistory.ts)) - Search transaction history. Parses raw API format (e.g., "購買1個：聖誕麋鹿") to extract item name, quantity, and unit price.

- **useTrackedItems** ([src/hooks/useTrackedItems.ts](src/hooks/useTrackedItems.ts)) - Manages tracked items persisted to localStorage. Supports price alerts when items drop below a threshold percentage of average price.

### Types

All TypeScript interfaces are in [src/types/market.ts](src/types/market.ts):
- `MarketResponse`, `MarketItem`, `MarketPet`, `Stall` - Current market data
- `PriceHistoryLog`, `PriceHistoryLogRaw` - Transaction records (raw and parsed)
- `TrackedItem`, `PriceRecord` - Local tracking data

### UI Components

Uses shadcn/ui components in `src/components/ui/`. Main feature components:
- `MarketSearch` - Search with server/type filters, currency exchange rate config
- `PriceHistory` - Transaction table with Recharts line chart
- `TrackedItems` - Manage tracked items and view price history

### Currency System

Two currencies: 金幣 (Gold, pricetype=0) and 魔晶 (Crystal, pricetype=1). Exchange rate is user-configurable (default 1:333) and stored in localStorage. Items are sorted by gold-equivalent price.

## Tech Stack

- Next.js 16 (App Router)
- React 19
- TypeScript (strict mode)
- Tailwind CSS 4
- Recharts for charts
- Sonner for toasts
- Path alias: `@/*` maps to `./src/*`
