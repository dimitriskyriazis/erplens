import type { NextRequest } from 'next/server';
import { windowsSignIn } from '@/lib/auth/signIn';

/**
 * POST /api/me: the Windows sign-in. IIS requires Windows authentication on this path only
 * (see scripts/iis/erplens.web.config), so each call is one Active Directory handshake. The
 * client calls it once per login, never on a timer; proxy.ts keeps the session alive after.
 */
export async function POST(request: NextRequest) {
  return windowsSignIn(request, 'api/me');
}
