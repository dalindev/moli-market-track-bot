import { describe, it, expect } from 'vitest';
import { toUpstreamMarketType } from './market-params';

describe('toUpstreamMarketType', () => {
  it('translates the app\'s legacy stall-type labels to the upstream codes', () => {
    expect(toUpstreamMarketType('道具攤位')).toBe('item');
    expect(toUpstreamMarketType('寵物攤位')).toBe('pet');
  });

  it('passes through the upstream codes unchanged', () => {
    expect(toUpstreamMarketType('all')).toBe('all');
    expect(toUpstreamMarketType('item')).toBe('item');
    expect(toUpstreamMarketType('pet')).toBe('pet');
  });

  it('falls back to all for missing or unknown values', () => {
    expect(toUpstreamMarketType(null)).toBe('all');
    expect(toUpstreamMarketType('')).toBe('all');
    expect(toUpstreamMarketType('items')).toBe('all');
  });
});
