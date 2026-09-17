/**
 * ERPLens session cookie: FastQuote's scheme, unchanged.
 *
 *   value   = base64url(JSON payload) + '.' + base64url(HMAC-SHA256(payloadEncoded, SESSION_SECRET))
 *   payload = { uid, win, iat, exp }   user id in tlm.Users, Windows identity, issued, expiry
 *
 * Sliding renewal: /api/me is the only endpoint IIS protects with Windows authentication,
 * so every call to it is a handshake against Active Directory. A browser holding a stale
 * cached credential (normal right after a domain password change) turns each handshake
 * into a bad-password attempt and eventually a lockout. proxy.ts therefore re-signs a
 * still-valid session with a later expiry on ordinary requests, capped at
 * SESSION_ABSOLUTE_TTL_SECONDS from the ORIGINAL login, so the identity is re-proven once
 * or twice a day instead of dozens of times.
 *
 * Web Crypto only (no node:crypto), so this one module serves proxy.ts and the route
 * handlers alike; Node 22 exposes crypto.subtle globally.
 */
import { SESSION_COOKIE_NAME, SESSION_EXP_COOKIE_NAME } from './constants';

export type SessionPayload = { uid: number; win: string; iat: number; exp: number };

export type CookieDescriptor = {
  name: string;
  value: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax';
  path: string;
  maxAge: number;
};

type CookieReader = { get(name: string): { value?: string } | undefined };

const readPositiveSeconds = (raw: string | undefined, fallback: number): number => {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

/** Lifetime stamped into a freshly minted or renewed session cookie. */
export const SESSION_TTL_SECONDS = readPositiveSeconds(process.env.SESSION_TTL_SECONDS, 60 * 60 * 8);

/** Hard ceiling, from the original login, on how far renewal may push a session. */
export const SESSION_ABSOLUTE_TTL_SECONDS = readPositiveSeconds(
  process.env.SESSION_ABSOLUTE_TTL_SECONDS,
  60 * 60 * 12,
);

/** Renew only once the cookie is inside this much of its expiry. */
export const SESSION_RENEW_WINDOW_SECONDS = readPositiveSeconds(
  process.env.SESSION_RENEW_WINDOW_SECONDS,
  Math.max(60, Math.floor(SESSION_TTL_SECONDS / 2)),
);

/** Do not re-sign for a gain smaller than this (already pinned to the ceiling). */
const MIN_RENEW_GAIN_SECONDS = 60;

// Fail loud once per worker: without the secret nobody can sign in and every session check
// fails, which would otherwise look like a mysterious wall of 401s. Not during `next build`
// (NEXT_PHASE is set by the build and inherited by its workers): the build evaluates route
// modules with NODE_ENV=production but without PM2's env block, so the warning there is
// noise, not a misconfiguration. The runtime check in signSession still throws either way.
if (
  !process.env.SESSION_SECRET &&
  process.env.NODE_ENV === 'production' &&
  process.env.NEXT_PHASE !== 'phase-production-build'
) {
  console.error('[auth] SESSION_SECRET is not set: sessions cannot be minted or verified');
}

const secret = (): string => process.env.SESSION_SECRET ?? '';

export const nowSeconds = (): number => Math.floor(Date.now() / 1000);

/** Keep false while the site is HTTP only; a Secure cookie is never sent over http://. */
export const getSessionCookieSecure = (): boolean => process.env.SESSION_COOKIE_SECURE === 'true';

// --- base64url / crypto helpers ----------------------------------------------------------

// TextEncoder always allocates a plain ArrayBuffer; the cast only narrows the lib typing
// (Uint8Array<ArrayBufferLike>) to what crypto.subtle's BufferSource parameter accepts.
const encodeText = (text: string): Uint8Array<ArrayBuffer> =>
  new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>;
const decodeText = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

const bytesToBase64Url = (bytes: Uint8Array): string => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const base64UrlToBytes = (input: string): Uint8Array => {
  let b64 = input.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4 !== 0) b64 += '=';
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
};

const sign = async (payloadEncoded: string, key: string): Promise<string> => {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encodeText(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encodeText(payloadEncoded));
  return bytesToBase64Url(new Uint8Array(signature));
};

const constantTimeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

// --- cookie descriptors ---------------------------------------------------------------------

export const buildSessionExpCookie = (exp: number, now: number = nowSeconds()): CookieDescriptor => ({
  name: SESSION_EXP_COOKIE_NAME,
  value: String(exp),
  httpOnly: false, // deliberately JS-readable: it is the client's "do I need /api/me?" signal
  secure: getSessionCookieSecure(),
  sameSite: 'lax',
  path: '/',
  maxAge: Math.max(0, exp - now),
});

/** Expire the hint so the client stops believing it has a live session. */
export const buildClearedSessionExpCookie = (): CookieDescriptor => ({
  name: SESSION_EXP_COOKIE_NAME,
  value: '',
  httpOnly: false,
  secure: getSessionCookieSecure(),
  sameSite: 'lax',
  path: '/',
  maxAge: 0,
});

/** Expire the session itself (used when a signed-in user has been removed from tlm.Users). */
export const buildClearedSessionCookie = (): CookieDescriptor => ({
  name: SESSION_COOKIE_NAME,
  value: '',
  httpOnly: true,
  secure: getSessionCookieSecure(),
  sameSite: 'lax',
  path: '/',
  maxAge: 0,
});

const signedCookies = async (
  payload: SessionPayload,
  now: number,
  maxAge: number,
): Promise<CookieDescriptor[]> => {
  const key = secret();
  if (!key) throw new Error('SESSION_SECRET is required for session cookies');
  const payloadEncoded = bytesToBase64Url(encodeText(JSON.stringify(payload)));
  const signature = await sign(payloadEncoded, key);
  return [
    {
      name: SESSION_COOKIE_NAME,
      value: `${payloadEncoded}.${signature}`,
      httpOnly: true,
      secure: getSessionCookieSecure(),
      sameSite: 'lax',
      path: '/',
      maxAge,
    },
    buildSessionExpCookie(payload.exp, now),
  ];
};

// --- mint / verify / renew --------------------------------------------------------------------

/**
 * Cookies to set after a successful Windows handshake: the signed httpOnly session plus
 * the JS-readable expiry hint. Always set both together; a hint that outlives its session
 * would make the client assume a session it no longer has.
 */
export async function mintSessionCookies(uid: number, win: string): Promise<CookieDescriptor[]> {
  const now = nowSeconds();
  return signedCookies({ uid, win, iat: now, exp: now + SESSION_TTL_SECONDS }, now, SESSION_TTL_SECONDS);
}

/** The decoded payload when the signature is valid and the session has not expired; else null. Never throws. */
export async function verifySessionCookie(raw: string | undefined | null): Promise<SessionPayload | null> {
  const key = secret();
  if (!raw || !key) return null;
  const dot = raw.indexOf('.');
  if (dot <= 0) return null;
  const payloadEncoded = raw.slice(0, dot);
  const signature = raw.slice(dot + 1);
  if (!signature) return null;
  try {
    const expected = await sign(payloadEncoded, key);
    if (!constantTimeEqual(expected, signature)) return null;
    const parsed = JSON.parse(decodeText(base64UrlToBytes(payloadEncoded))) as Partial<SessionPayload>;
    if (typeof parsed.uid !== 'number' || typeof parsed.win !== 'string' || typeof parsed.exp !== 'number') {
      return null;
    }
    if (parsed.exp < nowSeconds()) return null;
    const iat = typeof parsed.iat === 'number' ? parsed.iat : parsed.exp - SESSION_TTL_SECONDS;
    return { uid: parsed.uid, win: parsed.win, iat, exp: parsed.exp };
  } catch {
    return null;
  }
}

/**
 * New expiry for a sliding renewal, or null when renewal is not warranted: too early,
 * already expired, or the absolute ceiling leaves nothing meaningful to gain. `iat` is
 * preserved across renewals so the ceiling is measured from the real login.
 */
export const nextSessionExp = (payload: { iat: number; exp: number }, now: number = nowSeconds()): number | null => {
  const remaining = payload.exp - now;
  if (remaining <= 0) return null;
  if (remaining > SESSION_RENEW_WINDOW_SECONDS) return null;
  const ceiling = payload.iat + SESSION_ABSOLUTE_TTL_SECONDS;
  const candidate = Math.min(now + SESSION_TTL_SECONDS, ceiling);
  if (candidate <= payload.exp + MIN_RENEW_GAIN_SECONDS) return null;
  return candidate;
};

/**
 * Re-signs an ALREADY-VERIFIED session with a later expiry, or null when not due. Grants no
 * identity: same uid and win, original iat, only exp moves. Never throws.
 */
export async function renewSessionCookies(
  payload: SessionPayload,
  now: number = nowSeconds(),
): Promise<CookieDescriptor[] | null> {
  if (!secret()) return null;
  const exp = nextSessionExp(payload, now);
  if (exp === null) return null;
  try {
    return await signedCookies({ ...payload, exp }, now, Math.min(SESSION_TTL_SECONDS, Math.max(0, exp - now)));
  } catch {
    return null;
  }
}

/** For route handlers: the verified session carried by a request's cookies, or null. */
export async function readSession(cookies: CookieReader): Promise<SessionPayload | null> {
  return verifySessionCookie(cookies.get(SESSION_COOKIE_NAME)?.value);
}
