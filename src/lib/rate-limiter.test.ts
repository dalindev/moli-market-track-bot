import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { jitteredSleep, CircuitBreaker, fetchWithRetry } from './rate-limiter';

describe('jitteredSleep', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sleeps for a duration within the given range', async () => {
    const promise = jitteredSleep(100, 200);
    await vi.advanceTimersByTimeAsync(200);
    await expect(promise).resolves.toBeUndefined();
  });
});

describe('CircuitBreaker', () => {
  it('does not trip on isolated failures', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, pauseMs: 1000 });
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.pausedUntil()).toBeNull();
  });

  it('trips after threshold consecutive failures', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, pauseMs: 1000 });
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    const until = cb.pausedUntil();
    expect(until).not.toBeNull();
    expect(until!).toBeGreaterThan(Date.now());
  });

  it('resets failure count on success', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, pauseMs: 1000 });
    cb.recordFailure();
    cb.recordFailure();
    cb.recordSuccess();
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.pausedUntil()).toBeNull();
  });
});

describe('fetchWithRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns response on first success', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    const promise = fetchWithRetry('https://example.com', {}, { maxRetries: 3, baseDelayMs: 100, fetchFn: mockFetch });
    await vi.runAllTimersAsync();
    const res = await promise;
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('retries on 5xx with exponential backoff', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(new Response('err', { status: 500 }))
      .mockResolvedValueOnce(new Response('err', { status: 503 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const promise = fetchWithRetry('https://example.com', {}, { maxRetries: 3, baseDelayMs: 100, fetchFn: mockFetch });
    await vi.runAllTimersAsync();
    const res = await promise;
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('honors Retry-After header on 429', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(new Response('rate-limited', { status: 429, headers: { 'Retry-After': '5' } }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const promise = fetchWithRetry('https://example.com', {}, { maxRetries: 3, baseDelayMs: 100, fetchFn: mockFetch });
    await vi.runAllTimersAsync();
    const res = await promise;
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('throws after max retries', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('err', { status: 500 }));
    const promise = fetchWithRetry('https://example.com', {}, { maxRetries: 2, baseDelayMs: 100, fetchFn: mockFetch });
    const assertion = expect(promise).rejects.toThrow(/Max retries/);
    await vi.runAllTimersAsync();
    await assertion;
  });
});
