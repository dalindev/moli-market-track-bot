import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '@/proxy';
import { AUTH_COOKIE, makeAuthToken, passwordMatches, sameString, verifyAuthToken } from '@/lib/site-auth';

const PASSWORD = 'correct-horse-battery';
const NOW_MS = Date.UTC(2026, 9, 4, 12, 0, 0);
const NOW_SEC = Math.floor(NOW_MS / 1000);
const HOUR = 3600;

type Env = Record<string, string | undefined>;
function setEnv(env: Env) {
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) vi.stubEnv(k, undefined as unknown as string);
    else vi.stubEnv(k, v);
  }
}

function req(path: string, init: { method?: string; cookie?: string; body?: Record<string, string> } = {}) {
  const headers: Record<string, string> = {};
  if (init.cookie) headers.cookie = init.cookie;
  let body: URLSearchParams | undefined;
  if (init.body) {
    body = new URLSearchParams(init.body);
    headers['content-type'] = 'application/x-www-form-urlencoded';
  }
  return new NextRequest(`https://tracker.example.com${path}`, { method: init.method ?? 'GET', headers, body });
}

const passes = (res: Response) => res.headers.get('x-middleware-next') === '1';
const setCookieOf = (res: Response) => res.headers.get('set-cookie') ?? '';
const cookieValue = (res: Response) => /site-auth=([^;]*)/.exec(setCookieOf(res))?.[1] ?? '';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout'] });
  vi.setSystemTime(NOW_MS);
  setEnv({ SITE_PASSWORD: PASSWORD, NODE_ENV: 'production' });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

/**
 * Runs proxy() to completion. The failure delay is only scheduled after the (real, async) crypto calls finish,
 * so keep advancing the fake clock until the request settles instead of advancing once up front.
 */
async function run(r: NextRequest) {
  let done = false;
  const p = proxy(r).finally(() => {
    done = true;
  });
  while (!done) {
    await vi.advanceTimersByTimeAsync(200);
    await new Promise((resolve) => setImmediate(resolve)); // setImmediate is not faked
  }
  return p;
}

describe('site-auth token helpers', () => {
  it('accepts a freshly signed token', async () => {
    const t = await makeAuthToken(PASSWORD, NOW_SEC + HOUR);
    expect(await verifyAuthToken(PASSWORD, t, NOW_SEC)).toBe(true);
  });
  it('rejects an expired token', async () => {
    const t = await makeAuthToken(PASSWORD, NOW_SEC - 1);
    expect(await verifyAuthToken(PASSWORD, t, NOW_SEC)).toBe(false);
  });
  it('rejects a token signed with another password', async () => {
    const t = await makeAuthToken('other-password', NOW_SEC + HOUR);
    expect(await verifyAuthToken(PASSWORD, t, NOW_SEC)).toBe(false);
  });
  it('rejects a token whose expiry was edited', async () => {
    const t = await makeAuthToken(PASSWORD, NOW_SEC + HOUR);
    const forged = `${NOW_SEC + 999 * HOUR}.${t.split('.')[1]}`;
    expect(await verifyAuthToken(PASSWORD, forged, NOW_SEC)).toBe(false);
  });
  it.each([undefined, null, '', 'authenticated', '.', 'x.y', `${NOW_SEC + HOUR}.`, 12345, 'a'.repeat(500)])(
    'rejects garbage token %#',
    async (bad) => {
      expect(await verifyAuthToken(PASSWORD, bad, NOW_SEC)).toBe(false);
    },
  );
  it('password check is exact and type-safe', async () => {
    expect(await passwordMatches(PASSWORD, PASSWORD)).toBe(true);
    expect(await passwordMatches(PASSWORD, PASSWORD + ' ')).toBe(false);
    expect(await passwordMatches(PASSWORD, PASSWORD.toUpperCase())).toBe(false);
    expect(await passwordMatches(PASSWORD, '')).toBe(false);
    expect(await passwordMatches(PASSWORD, null)).toBe(false);
    expect(await passwordMatches(PASSWORD, ['a'])).toBe(false);
  });
  it('sameString handles length mismatch and non-strings', () => {
    expect(sameString('abc', 'abc')).toBe(true);
    expect(sameString('abc', 'abd')).toBe(false);
    expect(sameString('abc', 'abcd')).toBe(false);
    expect(sameString(1, 1)).toBe(false);
  });
});

describe('proxy gate', () => {
  it('passes /api/ through without auth (cron jobs)', async () => {
    expect(passes(await run(req('/api/market')))).toBe(true);
  });

  it('shows the login page (401, no-store, POST form) without a cookie', async () => {
    const res = await run(req('/'));
    expect(res.status).toBe(401);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const html = await res.text();
    expect(html).toContain('method="POST"');
    expect(html).toContain('action="/__login"');
    expect(html).not.toContain('Incorrect password');
    expect(html).not.toContain(PASSWORD);
  });

  it('rejects the old forgeable constant cookie', async () => {
    const res = await run(req('/', { cookie: 'site-auth=authenticated' }));
    expect(res.status).toBe(401);
  });

  it('rejects a cookie signed with another password', async () => {
    const t = await makeAuthToken('attacker-guess', NOW_SEC + HOUR);
    expect((await run(req('/', { cookie: `site-auth=${t}` }))).status).toBe(401);
  });

  it('rejects an expired cookie', async () => {
    const t = await makeAuthToken(PASSWORD, NOW_SEC - 5);
    expect((await run(req('/', { cookie: `site-auth=${t}` }))).status).toBe(401);
  });

  it('accepts a valid signed cookie', async () => {
    const t = await makeAuthToken(PASSWORD, NOW_SEC + HOUR);
    expect(passes(await run(req('/deals', { cookie: `site-auth=${t}` })))).toBe(true);
  });

  it('logs in via POST with the right password and sets a signed httpOnly cookie', async () => {
    const res = await run(req('/__login', { method: 'POST', body: { password: PASSWORD } }));
    expect(res.status).toBe(303);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/');
    const sc = setCookieOf(res);
    expect(sc).toMatch(/HttpOnly/i);
    expect(sc).toMatch(/Secure/i);
    expect(sc).toMatch(/SameSite=lax/i);
    expect(sc).toMatch(/Max-Age=604800/);
    const token = decodeURIComponent(cookieValue(res));
    expect(token).not.toBe('authenticated');
    expect(await verifyAuthToken(PASSWORD, token, NOW_SEC)).toBe(true);
  });

  it('the cookie from a login lets the next request through', async () => {
    const login = await run(req('/__login', { method: 'POST', body: { password: PASSWORD } }));
    const next = await run(req('/', { cookie: `site-auth=${cookieValue(login)}` }));
    expect(passes(next)).toBe(true);
  });

  it('rejects a wrong POST password with the error message and no cookie', async () => {
    const res = await run(req('/__login', { method: 'POST', body: { password: 'nope' } }));
    expect(res.status).toBe(401);
    expect(setCookieOf(res)).toBe('');
    expect(await res.text()).toContain('Incorrect password');
  });

  it('rejects a POST with no password field', async () => {
    const res = await run(req('/__login', { method: 'POST', body: { other: 'x' } }));
    expect(res.status).toBe(401);
    expect(setCookieOf(res)).toBe('');
  });

  it('delays failed attempts by about 0.8 s but not successful logins', async () => {
    async function elapsedFor(r: NextRequest) {
      const start = Date.now();
      await run(r);
      return Date.now() - start;
    }
    expect(await elapsedFor(req('/__login', { method: 'POST', body: { password: 'nope' } }))).toBeGreaterThanOrEqual(800);
    expect(await elapsedFor(req('/__login', { method: 'POST', body: { password: PASSWORD } }))).toBeLessThan(800);
  });

  it('keeps the legacy ?password= link working (bookmarks), with a signed cookie', async () => {
    const res = await run(req(`/?password=${encodeURIComponent(PASSWORD)}`));
    expect(res.status).toBe(303);
    const token = decodeURIComponent(cookieValue(res));
    expect(await verifyAuthToken(PASSWORD, token, NOW_SEC)).toBe(true);
  });

  it('wrong ?password= is rejected', async () => {
    const res = await run(req('/?password=wrong'));
    expect(res.status).toBe(401);
    expect(setCookieOf(res)).toBe('');
  });

  it('empty ?password= is rejected', async () => {
    expect((await run(req('/?password='))).status).toBe(401);
  });

  it('a GET to /__login is just the login page', async () => {
    expect((await run(req('/__login'))).status).toBe(401);
  });

  it('logout clears the cookie server-side and redirects home', async () => {
    const t = await makeAuthToken(PASSWORD, NOW_SEC + HOUR);
    const res = await run(req('/__logout', { cookie: `site-auth=${t}` }));
    expect(res.status).toBe(303);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/');
    const sc = setCookieOf(res);
    expect(sc).toMatch(/site-auth=;/);
    expect(sc).toMatch(/Max-Age=0/);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('fails closed in production when SITE_PASSWORD is unset', async () => {
    setEnv({ SITE_PASSWORD: '' });
    const res = await run(req('/'));
    expect(res.status).toBe(503);
    expect(passes(res)).toBe(false);
  });

  it('fails closed in production even if a stale constant cookie is presented and no password is set', async () => {
    setEnv({ SITE_PASSWORD: '' });
    expect((await run(req('/', { cookie: 'site-auth=authenticated' }))).status).toBe(503);
  });

  it('stays open in development when SITE_PASSWORD is unset', async () => {
    setEnv({ SITE_PASSWORD: '', NODE_ENV: 'development' });
    expect(passes(await run(req('/')))).toBe(true);
  });

  it('still protects in development when a password is set', async () => {
    setEnv({ NODE_ENV: 'development' });
    expect((await run(req('/'))).status).toBe(401);
  });

  it('exports the cookie name that AuthGate logout relies on', () => {
    expect(AUTH_COOKIE).toBe('site-auth');
  });
});
