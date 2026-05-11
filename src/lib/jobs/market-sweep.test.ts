import { describe, it, expect } from 'vitest';
import { filterRelevantListings, dedupeByListingKey, collectImageHints } from './market-sweep';
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

describe('collectImageHints', () => {
  it('records first sighting of each item id with a non-zero base image number', () => {
    const known = new Map([['偷襲密卷::0', 'uuid-1']]);
    const out = new Map<string, number>();
    const res = makeResponse({
      AAA_1: [{
        cdkey: 'AAA_1', price: 100, pricetype: 0, ITEM_ID: 1,
        ITEM_TRUENAME: '偷襲密卷', ITEM_FIRSTNAME: '',
        ITEM_MODIFYATTACK: 0, ITEM_MODIFYDEFENCE: 0, ITEM_MODIFYAGILITY: 0, ITEM_MODIFYMAGIC: 0,
        ITEM_MAXDURABILITY: 0, ITEM_DURABILITY: 0, ITEM_LEVEL: 0,
        ITEM_BASEIMAGENUMBER: 26805,
        ITEM_ABLEUSEFIELD: 0, ITEM_ABLEUSEBATTLE: 0, ITEM_CANSELL: 0,
        ITEM_REMAIN: 1, ITEM_MAXREMAIN: 1,
      }],
    });
    collectImageHints(res, known, out);
    expect(out.get('uuid-1')).toBe(26805);
  });

  it('ignores items not in the known map', () => {
    const known = new Map<string, string>(); // empty
    const out = new Map<string, number>();
    const res = makeResponse({
      AAA_1: [{
        cdkey: 'AAA_1', price: 100, pricetype: 0, ITEM_ID: 1,
        ITEM_TRUENAME: 'unknown', ITEM_FIRSTNAME: '',
        ITEM_MODIFYATTACK: 0, ITEM_MODIFYDEFENCE: 0, ITEM_MODIFYAGILITY: 0, ITEM_MODIFYMAGIC: 0,
        ITEM_MAXDURABILITY: 0, ITEM_DURABILITY: 0, ITEM_LEVEL: 0,
        ITEM_BASEIMAGENUMBER: 12345,
        ITEM_ABLEUSEFIELD: 0, ITEM_ABLEUSEBATTLE: 0, ITEM_CANSELL: 0,
        ITEM_REMAIN: 1, ITEM_MAXREMAIN: 1,
      }],
    });
    collectImageHints(res, known, out);
    expect(out.size).toBe(0);
  });
});

describe('dedupeByListingKey', () => {
  it('returns empty for empty input', () => {
    expect(dedupeByListingKey([])).toEqual([]);
  });

  it('keeps only first occurrence of each listing_key', () => {
    const rows = [
      { item_id: 'a', price: 100, pricetype: 0, server: 1, stall_name: 's', stall_cdkey: 'c1', coords: 'x', quantity: 1, source: 'market' as const, listing_key: 'k1' },
      { item_id: 'a', price: 100, pricetype: 0, server: 1, stall_name: 's', stall_cdkey: 'c1', coords: 'x', quantity: 1, source: 'market' as const, listing_key: 'k1' },
      { item_id: 'b', price: 200, pricetype: 0, server: 1, stall_name: 's', stall_cdkey: 'c2', coords: 'x', quantity: 1, source: 'market' as const, listing_key: 'k2' },
    ];
    const result = dedupeByListingKey(rows);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.listing_key).sort()).toEqual(['k1', 'k2']);
  });
});
