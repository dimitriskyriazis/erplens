import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME, SESSION_EXP_COOKIE_NAME } from '@/lib/auth/constants';
import { isAuthRequired } from '@/lib/auth/policy';
import {
  buildClearedSessionExpCookie,
  buildSessionExpCookie,
  nowSeconds,
  renewSessionCookies,
  verifySessionCookie,
  type SessionPayload,
} from '@/lib/auth/session';

/**
 * The only authentication gate once IIS serves the app anonymously (Windows auth is scoped
 * to /api/me and /api/sso): verifies the session cookie's signature and expiry on every
 * request, rejects API calls without one, and slides a still-valid session forward so the
 * client never needs a timed Windows handshake (see lib/auth/session.ts for why).
 *
 * Pages are NOT rejected here. They carry no data of their own (everything flows through
 * /api/*), and letting the shell render is what lets AuthProvider run the sign-in and show
 * "Access denied" to an unknown account instead of a bare 401 on a deep link.
 */

const STATIC_ASSET_RE = /\.(?:ico|png|jpe?g|gif|svg|webp|avif|css|js|mjs|map|txt|xml|woff2?|ttf|otf|eot)$/i;

/** API paths that answer without a session: the probe, the sign-in pair, and the session read. */
const OPEN_API = new Set(['/api/health', '/api/me', '/api/sso', '/api/session']);

/** These mint their own cookies; touching Set-Cookie here as well would race them. */
const MINTS_OWN_SESSION = new Set(['/api/me', '/api/sso']);

async function applySessionRenewal(
  request: NextRequest,
  response: NextResponse,
  payload: SessionPayload | null,
): Promise<void> {
  const hint = request.cookies.get(SESSION_EXP_COOKIE_NAME)?.value ?? null;

  if (!payload) {
    // Clear a stale hint so the client re-authenticates instead of trusting a dead session.
    if (hint) response.cookies.set(buildClearedSessionExpCookie());
    return;
  }

  const now = nowSeconds();
  const renewed = await renewSessionCookies(payload, now);
  if (renewed) {
    for (const cookie of renewed) response.cookies.set(cookie);
    return;
  }
  // Not due for renewal: just make sure the client's view of the expiry is accurate.
  if (hint !== String(payload.exp)) response.cookies.set(buildSessionExpCookie(payload.exp, now));
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (pathname.startsWith('/_next/') || STATIC_ASSET_RE.test(pathname)) return NextResponse.next();
  if (MINTS_OWN_SESSION.has(pathname)) return NextResponse.next();

  const payload = await verifySessionCookie(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  const isApi = pathname.startsWith('/api/');

  if (isApi && !OPEN_API.has(pathname) && request.method !== 'OPTIONS' && isAuthRequired() && !payload) {
    const response = NextResponse.json(
      { ok: false, error: 'Authentication required', reason: 'no_session' },
      { status: 401 },
    );
    if (request.cookies.has(SESSION_EXP_COOKIE_NAME)) response.cookies.set(buildClearedSessionExpCookie());
    return response;
  }

  const response = NextResponse.next();
  await applySessionRenewal(request, response, payload);
  return response;
}

export const config = {
  matcher: '/:path*',
};
