export interface Stall {
  server: number;
  name: string;
  x: number;
  y: number;
  time: number;
  cdkey: string;
  coords: string;
  expires: string;
}

export interface MarketItem {
  cdkey: string;
  price: number;
  pricetype: number;
  ITEM_ID: number;
  ITEM_TRUENAME: string;
  ITEM_FIRSTNAME: string;
  ITEM_MODIFYATTACK: number;
  ITEM_MODIFYDEFENCE: number;
  ITEM_MODIFYAGILITY: number;
  ITEM_MODIFYMAGIC: number;
  ITEM_MAXDURABILITY: number;
  ITEM_DURABILITY: number;
  ITEM_LEVEL: number;
  ITEM_BASEIMAGENUMBER: number;
  ITEM_ABLEUSEFIELD: number;
  ITEM_ABLEUSEBATTLE: number;
  ITEM_CANSELL: number;
  ITEM_REMAIN: number;        // Stack quantity remaining
  ITEM_MAXREMAIN: number;     // Maximum stack size
}

export interface MarketPet {
  cdkey: string;
  price: number;
  pricetype: number;
  Name: string;
  Lv: number;
  BaseImgnum: number;
}

export interface MarketResponse {
  page: number;
  perPage: number;
  totalFiltered: number;
  stalls: Stall[];
  itemsByCd: Record<string, MarketItem[]>;
  petsByCd?: Record<string, MarketPet[]>;
}

export interface TrackedItem {
  id: string;
  itemName: string;
  itemId: number;
  targetPrice: number;
  alertThreshold: number; // percentage below average to alert
  priceHistory: PriceRecord[];
  createdAt: string;
  lastChecked: string;
  isActive: boolean;
}

export interface PriceRecord {
  price: number;
  server: number;
  stallName: string;
  coords: string;
  timestamp: string;
}

export interface SearchParams {
  search: string;
  type: 'all' | '道具攤位' | '寵物攤位';
  server: 'all' | '1' | '2' | '3' | '4' | '5';
  exact: boolean;
  page: number;
}

// Price history types - raw API response
export interface PriceHistoryLogRaw {
  id: number;
  cdkey: string;
  buycdkey: string;
  buyname: string;
  buff: string; // e.g., "購買1個：聖誕麋鹿" or "購買1隻：聖誕麋鹿"
  price: number;
  pricetype: number; // 0 = 金幣, 1 = 魔晶
  time: number; // Unix timestamp
  time_text: string;
  check: number;
}

// Parsed price history log
export interface PriceHistoryLog {
  id: number;
  name: string;
  quantity: number;
  price: number; // Total price for all items
  unitPrice: number; // Price per single item (price / quantity)
  pricetype: number; // 0 = 金幣, 1 = 魔晶
  type: 'item' | 'pet';
  time: string; // ISO timestamp
  buyerName: string;
}

export interface PriceHistoryResponseRaw {
  page: number;
  perPage: number;
  totalFiltered: number;
  logs: PriceHistoryLogRaw[];
}

export interface PriceHistoryResponse {
  page: number;
  perPage: number;
  totalFiltered: number;
  logs: PriceHistoryLog[];
}

export interface PriceHistorySearchParams {
  search: string;
  type: 'all' | 'item' | 'pet';
  page: number;
}
