import { describe, it, expect, vi } from 'vitest';
import { fetchUpstreamJson } from './upstream-fetch';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Collects the delays requested so tests can assert on backoff without real waiting. */
function recordingSleep() {
  const slept: number[] = [];
  return { slept, sleepFn: async (ms: number) => { slept.push(ms); } };
}

describe('fetchUpstreamJson', () => {
  it('returns parsed data on first success', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, { page: 1, totalFiltered: 7 }));
    const { sleepFn, slept } = recordingSleep();

    const result = await fetchUpstreamJson<{ totalFiltered: number }>('https://x/y', { fetchFn, sleepFn });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.totalFiltered).toBe(7);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(slept).toEqual([]);
  });

  it('retries a 503 service_busy and succeeds on the next attempt', async () => {
    // This is the exact failure that broke /enchant-stones on first load.
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(jsonResponse(503, {
        status: 'error', error: 'service_busy', message: '伺服器忙碌中。', retry_after: 2,
      }))
      .mockResolvedValueOnce(jsonResponse(200, { page: 1 }));
    const { sleepFn, slept } = recordingSleep();

    const result = await fetchUpstreamJson('https://x/y', { fetchFn, sleepFn });

    expect(result.ok).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    // Honours the body's retry_after (seconds), not a header — upstream sends no Retry-After header.
    expect(slept).toEqual([2000]);
  });

  it('gives up after maxAttempts and reports service_busy as 503 with retry seconds', async () => {
    // A Response body can only be read once, so hand out a fresh one per attempt.
    const busy = () => jsonResponse(503, {
      status: 'error', error: 'service_busy', message: '伺服器忙碌中。', retry_after: 1,
    });
    const fetchFn = vi.fn().mockImplementation(async () => busy());
    const { sleepFn } = recordingSleep();

    const result = await fetchUpstreamJson('https://x/y', { fetchFn, sleepFn, maxAttempts: 3 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.status).toBe(503);
      expect(result.failure.code).toBe('service_busy');
      expect(result.failure.retryAfterSeconds).toBe(1);
      expect(result.failure.attempts).toBe(3);
    }
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('retries a 429 rate_limited and reports it as 429 when it never clears', async () => {
    // Observed live: 24 concurrent proxy calls make the upstream answer
    // 429 {"error":"rate_limited","message":"請求過於頻繁，請稍候再試。"}.
    const fetchFn = vi.fn().mockImplementation(async () => jsonResponse(429, {
      status: 'error', error: 'rate_limited', message: '請求過於頻繁，請稍候再試。', retry_after: 1,
    }));
    const { sleepFn, slept } = recordingSleep();

    const result = await fetchUpstreamJson('https://x/y', { fetchFn, sleepFn, maxAttempts: 3 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.status).toBe(429);
      expect(result.failure.code).toBe('rate_limited');
    }
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(slept).toEqual([1000, 1000]);
  });

  it('does not retry invalid_query — a 400 is our bug, not a transient blip', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(400, {
      status: 'error', error: 'invalid_query', message: '查詢條件格式不正確。', retry_after: 0,
    }));
    const { sleepFn, slept } = recordingSleep();

    const result = await fetchUpstreamJson('https://x/y', { fetchFn, sleepFn });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.status).toBe(400);
      expect(result.failure.code).toBe('invalid_query');
    }
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(slept).toEqual([]);
  });

  it('treats an error envelope returned with HTTP 200 as a failure', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, {
      status: 'error', error: 'invalid_query', message: '查詢條件格式不正確。', retry_after: 0,
    }));
    const { sleepFn } = recordingSleep();

    const result = await fetchUpstreamJson('https://x/y', { fetchFn, sleepFn });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe('invalid_query');
  });

  it('retries network errors with exponential backoff', async () => {
    const fetchFn = vi.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(jsonResponse(200, { ok: 1 }));
    const { sleepFn, slept } = recordingSleep();

    const result = await fetchUpstreamJson('https://x/y', { fetchFn, sleepFn, baseDelayMs: 100 });

    expect(result.ok).toBe(true);
    expect(slept).toEqual([100, 200]);
  });

  it('surfaces a network failure as 502 once retries are exhausted', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    const { sleepFn } = recordingSleep();

    const result = await fetchUpstreamJson('https://x/y', { fetchFn, sleepFn, maxAttempts: 2, baseDelayMs: 10 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.status).toBe(502);
      expect(result.failure.code).toBe('network_error');
    }
  });

  it('rethrows AbortError instead of retrying a cancelled request', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError'));
    const { sleepFn } = recordingSleep();

    await expect(fetchUpstreamJson('https://x/y', { fetchFn, sleepFn })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('stops retrying once the delay budget would be exceeded', async () => {
    // retry_after of 30s must not stall a serverless request for 30s.
    const fetchFn = vi.fn().mockImplementation(async () => jsonResponse(503, {
      status: 'error', error: 'service_busy', retry_after: 30,
    }));
    const { sleepFn, slept } = recordingSleep();

    const result = await fetchUpstreamJson('https://x/y', {
      fetchFn, sleepFn, maxAttempts: 5, maxTotalDelayMs: 5_000,
    });

    expect(result.ok).toBe(false);
    // A 30s wait blows the 5s budget, so it never sleeps and never re-fetches.
    expect(slept).toEqual([]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('retries a plain 500 with no JSON body', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(new Response('<html>gateway blew up</html>', { status: 500 }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: 1 }));
    const { sleepFn } = recordingSleep();

    const result = await fetchUpstreamJson('https://x/y', { fetchFn, sleepFn, baseDelayMs: 10 });

    expect(result.ok).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('fails cleanly when a 200 body is not JSON at all', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('not json', { status: 200 }));
    const { sleepFn } = recordingSleep();

    const result = await fetchUpstreamJson('https://x/y', { fetchFn, sleepFn, maxAttempts: 1 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe('bad_payload');
  });
});
