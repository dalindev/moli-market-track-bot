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
}

export interface MarketResponse {
  page: number;
  perPage: number;
  totalFiltered: number;
  stalls: Stall[];
  itemsByCd: Record<string, MarketItem[]>;
  petsByCd?: Record<string, unknown[]>;
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
