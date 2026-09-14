import { NextResponse, type NextRequest } from 'next/server';
import { devWindowsIdentity, isAuthRequired } from './policy';
import { mintSessionCookies } from './session';
import { findUserByWindowsIdentity } from './userLookup';
import { getWindowsIdentityFromHeaders } from './windowsIdentity';

/**
 * The Windows sign-in shared by POST /api/me and GET /api/sso.
 *
 * IIS requires Windows authentication on exactly those two paths, stamps the result into
 * X-Windows-User, and the app maps that identity to a row of tlm.Users. The request body
 * is never consulted for identity. On success the response carries the signed session
 * cookie and its expiry hint; everything else in the app is then authorised by that cookie.
 *
 * `authRequired` in every response tells the client whether proxy.ts is gating API calls,
 * so it can decide between "sign-in unavailable" and "carry on anonymously".
 */
export async function windowsSignIn(request: NextRequest, endpoint: string): Promise<NextResponse> {
  const authRequired = isAuthRequired();
  const fromIis = getWindowsIdentityFromHeaders(request.headers);
  const windowsUserName = fromIis ?? devWindowsIdentity();

  if (!windowsUserName) {
    return NextResponse.json(
      { ok: false, error: 'Missing Windows identity header', reason: 'no_windows_identity', authRequired },
      { status: 401 },
    );
  }

  try {
    const user = await findUserByWindowsIdentity(windowsUserName);
    if (!user) {
      return NextResponse.json(
        {
          ok: false,
          error: 'No matching application user for Windows identity',
          reason: 'unrecognized_windows_user',
          windowsUserName,
          authRequired,
        },
        { status: 403 },
      );
    }

    const cookies = await mintSessionCookies(user.id, windowsUserName);
    const response = NextResponse.json({ ok: true, user, windowsUserName, authRequired });
    for (const cookie of cookies) response.cookies.set(cookie);
    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${endpoint}] sign-in failed`, { windowsUserName, message });
    return NextResponse.json(
      {
        ok: false,
        error: process.env.NODE_ENV === 'production' ? 'Server error' : message,
        reason: 'sign_in_failed',
        authRequired,
      },
      { status: 500 },
    );
  }
}
