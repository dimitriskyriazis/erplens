'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import AccessDeniedPage from './AccessDeniedPage';
import { SESSION_EXP_COOKIE_NAME } from '@/lib/auth/constants';

/**
 * Establishes who the user is before anything renders, FastQuote style.
 *
 * On load: if the expiry hint says the session is healthy, read it back through the
 * anonymous GET /api/session. Otherwise do the one Windows handshake, POST /api/me, which
 * IIS protects with Windows authentication. Children render only once that is settled, so
 * no grid ever fires an authenticated request before a session cookie exists.
 *
 * Afterwards the session is kept alive by proxy.ts on ordinary requests; this component
 * only re-authenticates when the hint shows the session genuinely about to lapse (a tab
 * open past the absolute cap, a laptop back from sleep). Never on a fixed timer: every
 * /api/me is an Active Directory handshake, and a stale cached credential on a timer is
 * how accounts get locked out.
 */

/** Mirrors AppUser in lib/auth/userLookup.ts; /api/me and /api/session return it verbatim. */
export type AuthUser = {
  id: number;
  username: string;
  domainName: string | null;
  roleId: number | null;
  roleName: string | null;
};

type AuthStatus = 'checking' | 'ready' | 'denied' | 'unavailable';

type AuthContextValue = {
  status: AuthStatus;
  user: AuthUser | null;
  windowsUserName: string | null;
  authRequired: boolean;
  retry: () => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// A session with more than this much life left needs no handshake at all.
const SESSION_OK_MARGIN_SECONDS = 15 * 60;
// How often to look at the hint cookie. A local read; it costs nothing unless the session is about to lapse.
const SESSION_CHECK_INTERVAL_MS = 5 * 60 * 1000;
// Coalesce bursts of focus/visibility events so we never re-mint more than once per window.
const MIN_REMINT_GAP_MS = 5 * 60 * 1000;

const readRawCookie = (name: string): string | null => {
  if (typeof document === 'undefined') return null;
  for (const segment of document.cookie.split(';')) {
    const trimmed = segment.trim();
    if (trimmed.startsWith(`${name}=`)) return decodeURIComponent(trimmed.slice(name.length + 1));
  }
  return null;
};

/** Seconds of session left per the hint cookie, or null when there is no usable hint. */
const sessionRemainingSeconds = (): number | null => {
  const raw = readRawCookie(SESSION_EXP_COOKIE_NAME);
  if (!raw) return null;
  const exp = Number(raw);
  return Number.isFinite(exp) ? Math.floor(exp - Date.now() / 1000) : null;
};

const hasHealthySession = (): boolean => {
  const remaining = sessionRemainingSeconds();
  return remaining !== null && remaining > SESSION_OK_MARGIN_SECONDS;
};

type MePayload = {
  ok?: boolean;
  reason?: string;
  error?: string;
  windowsUserName?: string | null;
  authRequired?: boolean;
  user?: AuthUser | null;
};

type SignInResult =
  | { kind: 'ok'; user: AuthUser | null; windowsUserName: string | null; authRequired: boolean }
  | { kind: 'denied'; windowsUserName: string | null; authRequired: boolean }
  | { kind: 'no_identity'; authRequired: boolean }
  | { kind: 'failed'; authRequired: boolean };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const parse = async (res: Response): Promise<MePayload | null> =>
  (await res.json().catch(() => null)) as MePayload | null;

/** GET /api/session: cheap, anonymous at IIS. Null when there is no live session. */
async function readSession(): Promise<SignInResult | null> {
  try {
    const res = await fetch('/api/session', { credentials: 'include', cache: 'no-store' });
    const body = await parse(res);
    if (res.status === 403 && body?.reason === 'unrecognized_windows_user') {
      return { kind: 'denied', windowsUserName: body.windowsUserName ?? null, authRequired: body.authRequired ?? true };
    }
    if (!res.ok || !body?.ok) return null;
    return {
      kind: 'ok',
      user: body.user ?? null,
      windowsUserName: body.windowsUserName ?? null,
      authRequired: body.authRequired ?? true,
    };
  } catch {
    return null;
  }
}

/**
 * POST /api/me: the Windows handshake. Retries 429 and 5xx with backoff, but caps 5xx
 * attempts tightly: a backend mid-restart is not fixed by retrying, while every retry is
 * another AD handshake.
 */
async function signInViaWindows(): Promise<SignInResult> {
  const MAX_ATTEMPTS = 4;
  const MAX_SERVER_ERROR_ATTEMPTS = 2;
  let serverErrors = 0;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      const res = await fetch('/api/me', { method: 'POST', credentials: 'include', cache: 'no-store' });
      const isServerError = res.status >= 500;
      if (isServerError) serverErrors += 1;
      const retriesLeft = attempt < MAX_ATTEMPTS - 1 && !(isServerError && serverErrors >= MAX_SERVER_ERROR_ATTEMPTS);

      if ((res.status === 429 || isServerError) && retriesLeft) {
        const retryAfter = Number(res.headers.get('Retry-After'));
        const backoffMs =
          Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 15000) : Math.min(1000 * 2 ** attempt, 8000);
        await sleep(backoffMs);
        continue;
      }

      const body = await parse(res);
      const authRequired = body?.authRequired ?? true;
      if (res.status === 403 && body?.reason === 'unrecognized_windows_user') {
        return { kind: 'denied', windowsUserName: body.windowsUserName ?? null, authRequired };
      }
      if (res.status === 401) return { kind: 'no_identity', authRequired };
      if (!res.ok || !body?.ok) return { kind: 'failed', authRequired };
      return { kind: 'ok', user: body.user ?? null, windowsUserName: body.windowsUserName ?? null, authRequired };
    } catch {
      if (attempt < MAX_ATTEMPTS - 1) {
        await sleep(Math.min(1000 * 2 ** attempt, 8000));
        continue;
      }
    }
  }
  return { kind: 'failed', authRequired: true };
}

/**
 * One sign-in per page load, shared by every effect run. React Strict Mode mounts effects
 * twice in development and a retry can overlap a slow first attempt; without this each of
 * those would be another Active Directory handshake.
 */
let bootstrapInFlight: Promise<SignInResult> | null = null;

const bootstrap = (): Promise<SignInResult> => {
  if (!bootstrapInFlight) {
    bootstrapInFlight = (async () => {
      let result: SignInResult | null = null;
      if (hasHealthySession()) result = await readSession();
      if (!result) result = await signInViaWindows();
      return result;
    })().finally(() => {
      bootstrapInFlight = null;
    });
  }
  return bootstrapInFlight;
};

function FullScreenMessage({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="auth-screen">
      <div className="auth-screen__card">
        <h1 className="auth-screen__title">{title}</h1>
        {children}
      </div>
    </div>
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('checking');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [windowsUserName, setWindowsUserName] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(true);
  const [failureKind, setFailureKind] = useState<'no_identity' | 'failed' | null>(null);
  const [attempt, setAttempt] = useState(0);

  const applyResult = useCallback((result: SignInResult) => {
    setAuthRequired(result.authRequired);
    switch (result.kind) {
      case 'ok':
        setUser(result.user);
        setWindowsUserName(result.windowsUserName);
        setFailureKind(null);
        setStatus('ready');
        return;
      case 'denied':
        setUser(null);
        setWindowsUserName(result.windowsUserName);
        setStatus('denied');
        return;
      case 'no_identity':
      case 'failed':
        setUser(null);
        setFailureKind(result.kind);
        // With the gate open the app still works anonymously, so let it render and say
        // "Not signed in" in the nav. With the gate closed nothing would work: explain instead.
        setStatus(result.authRequired ? 'unavailable' : 'ready');
    }
  }, []);

  // Initial bootstrap (and manual retries). Strict Mode's second run reuses the same promise.
  useEffect(() => {
    let cancelled = false;
    void bootstrap().then((result) => {
      if (!cancelled) applyResult(result);
    });
    return () => {
      cancelled = true;
    };
  }, [attempt, applyResult]);

  // Quiet re-authentication for a tab whose session is genuinely about to lapse.
  useEffect(() => {
    if (status !== 'ready' || !authRequired) return;
    if (typeof window === 'undefined') return;

    let lastRemintAt = Date.now();
    let cancelled = false;
    let inFlight = false;

    const remintIfExpiring = async () => {
      if (cancelled || inFlight) return;
      if (document.visibilityState === 'hidden') return;
      if (hasHealthySession()) return;
      inFlight = true;
      try {
        const result = await signInViaWindows();
        if (cancelled) return;
        lastRemintAt = Date.now();
        // Only good news is applied. A transient failure here must not tear the app down;
        // the next tick, or a real request's own error path, recovers.
        if (result.kind === 'ok' || result.kind === 'denied') applyResult(result);
      } finally {
        inFlight = false;
      }
    };

    const intervalId = window.setInterval(() => void remintIfExpiring(), SESSION_CHECK_INTERVAL_MS);
    const onWake = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastRemintAt < MIN_REMINT_GAP_MS) return;
      void remintIfExpiring();
    };
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);
    window.addEventListener('online', onWake);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('focus', onWake);
      window.removeEventListener('online', onWake);
    };
  }, [status, authRequired, applyResult]);

  const retry = useCallback(() => {
    setStatus('checking');
    setAttempt((n) => n + 1);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, windowsUserName, authRequired, retry }),
    [status, user, windowsUserName, authRequired, retry],
  );

  if (status === 'checking') {
    return (
      <AuthContext.Provider value={value}>
        <div className="auth-screen auth-screen--quiet">Signing in…</div>
      </AuthContext.Provider>
    );
  }

  if (status === 'denied') {
    return (
      <AuthContext.Provider value={value}>
        <AccessDeniedPage windowsIdentity={windowsUserName} />
      </AuthContext.Provider>
    );
  }

  if (status === 'unavailable') {
    return (
      <AuthContext.Provider value={value}>
        <FullScreenMessage title="Sign-in unavailable">
          {failureKind === 'no_identity' ? (
            <p className="auth-screen__message">
              The server did not receive your Windows identity. This usually means Windows
              authentication is not configured on the web server for this site.
            </p>
          ) : (
            <p className="auth-screen__message">
              ERPLens could not reach the sign-in service. It may be restarting.
            </p>
          )}
          <p className="auth-screen__message">
            <button type="button" className="auth-screen__button" onClick={retry}>
              Try again
            </button>
          </p>
        </FullScreenMessage>
      </AuthContext.Provider>
    );
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
};
