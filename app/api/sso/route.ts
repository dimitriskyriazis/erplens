import type { NextRequest } from 'next/server';
import { windowsSignIn } from '@/lib/auth/signIn';

/**
 * GET /api/sso: the same sign-in as POST /api/me, reachable from a browser address bar.
 * Handy for checking the IIS side: opening it should show your tlm.Users row as JSON.
 */
export async function GET(request: NextRequest) {
  return windowsSignIn(request, 'api/sso');
}
