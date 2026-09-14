import { NextResponse, type NextRequest } from 'next/server';
import { isAuthRequired } from '@/lib/auth/policy';
import { buildClearedSessionCookie, buildClearedSessionExpCookie, readSession } from '@/lib/auth/session';
import { findUserById } from '@/lib/auth/userLookup';

/**
 * GET /api/session: who the current session cookie belongs to. Anonymous at IIS (no Windows
 * handshake), so the client uses it on page load whenever the expiry hint says the session
 * is still healthy, and only falls back to POST /api/me when there is no usable session.
 */
export async function GET(request: NextRequest) {
  const authRequired = isAuthRequired();
  const session = await readSession(request.cookies);
  if (!session) {
    return NextResponse.json({ ok: false, error: 'No session', reason: 'no_session', authRequired }, { status: 401 });
  }

  try {
    const user = await findUserById(session.uid);
    if (!user) {
      // Signed in earlier, since removed from tlm.Users: end the session now rather than at expiry.
      const response = NextResponse.json(
        {
          ok: false,
          error: 'User no longer authorised',
          reason: 'unrecognized_windows_user',
          windowsUserName: session.win,
          authRequired,
        },
        { status: 403 },
      );
      response.cookies.set(buildClearedSessionCookie());
      response.cookies.set(buildClearedSessionExpCookie());
      return response;
    }
    return NextResponse.json({ ok: true, user, windowsUserName: session.win, exp: session.exp, authRequired });
  } catch (err) {
    // The session itself is valid; only the name lookup failed. Report what the cookie knows.
    const message = err instanceof Error ? err.message : String(err);
    console.error('[api/session] user lookup failed', { uid: session.uid, message });
    return NextResponse.json({
      ok: true,
      user: null,
      windowsUserName: session.win,
      exp: session.exp,
      authRequired,
      degraded: true,
    });
  }
}
