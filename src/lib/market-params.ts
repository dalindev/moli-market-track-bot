// member.starcg.net/market.php accepts type=all|item|pet; any other value is a
// 400 invalid_query. The app historically used the display labels as values.
export type UpstreamMarketType = 'all' | 'item' | 'pet';

const TYPE_MAP: Record<string, UpstreamMarketType> = {
  all: 'all',
  item: 'item',
  pet: 'pet',
  道具攤位: 'item',
  寵物攤位: 'pet',
};

export function toUpstreamMarketType(type: string | null | undefined): UpstreamMarketType {
  return (type && TYPE_MAP[type]) || 'all';
}
