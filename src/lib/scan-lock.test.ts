import { describe, it, expect } from 'vitest';
import { LockRegistry } from './scan-lock';

describe('LockRegistry', () => {
  it('grants lock when free', () => {
    const r = new LockRegistry();
    expect(r.acquire('discovery')).toBe(true);
  });

  it('refuses lock when already held', () => {
    const r = new LockRegistry();
    r.acquire('discovery');
    expect(r.acquire('discovery')).toBe(false);
  });

  it('allows different kinds simultaneously', () => {
    const r = new LockRegistry();
    expect(r.acquire('discovery')).toBe(true);
    expect(r.acquire('market_sweep')).toBe(true);
  });

  it('release allows re-acquire', () => {
    const r = new LockRegistry();
    r.acquire('discovery');
    r.release('discovery');
    expect(r.acquire('discovery')).toBe(true);
  });

  it('isHeld reports correct state', () => {
    const r = new LockRegistry();
    expect(r.isHeld('discovery')).toBe(false);
    r.acquire('discovery');
    expect(r.isHeld('discovery')).toBe(true);
    r.release('discovery');
    expect(r.isHeld('discovery')).toBe(false);
  });
});
