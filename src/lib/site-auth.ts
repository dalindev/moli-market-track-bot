// Signed session token + constant-time password check for the site password gate (src/proxy.ts).
//
// The old gate stored the constant cookie "site-auth=authenticated", so anyone could skip the password by setting
// that cookie by hand. The cookie is now "<expiry>.<HMAC-SHA256(SITE_PASSWORD, expiry)>": it cannot be forged
// without the password, it expires, and changing SITE_PASSWORD logs everyone out.
// Web Crypto only, so it runs in the Node and Edge runtimes alike.

export const AUTH_COOKIE = 'site-auth';
export const AUTH_MAX_AGE_S = 60 * 60 * 24 * 7;

const TOKEN_CONTEXT = 'moli-site-auth.v1.';
const LOGIN_CONTEXT = 'moli-site-login.v1.';
const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}

/** Constant-time comparison; strings of different length are simply unequal. */
export function sameString(a: unknown, b: unknown): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function makeAuthToken(secret: string, expiresAtSec: number): Promise<string> {
  return `${expiresAtSec}.${b64url(await hmac(secret, TOKEN_CONTEXT + expiresAtSec))}`;
}

export async function verifyAuthToken(secret: string, token: unknown, nowSec: number): Promise<boolean> {
  if (typeof token !== 'string' || token.length > 200) return false;
  const dot = token.indexOf('.');
  if (dot < 1) return false;
  const exp = token.slice(0, dot);
  if (!/^\d{9,12}$/.test(exp) || Number(exp) <= nowSec) return false;
  const expected = b64url(await hmac(secret, TOKEN_CONTEXT + exp));
  return sameString(token.slice(dot + 1), expected);
}

/** Compares fixed-length digests, so timing does not reveal how much of the password was right. */
export async function passwordMatches(secret: string, candidate: unknown): Promise<boolean> {
  if (typeof candidate !== 'string') return false;
  const a = b64url(await hmac(secret, LOGIN_CONTEXT + candidate));
  const b = b64url(await hmac(secret, LOGIN_CONTEXT + secret));
  return sameString(a, b);
}
