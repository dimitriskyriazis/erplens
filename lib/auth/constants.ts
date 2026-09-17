// Cookie and header names for ERPLens authentication. Host-scoped cookies, so they never
// collide with FastQuote's fastquote-* cookies even though both apps live under telmaco.gr.

/** Signed, httpOnly session: `<base64url payload>.<base64url HMAC-SHA256>`. */
export const SESSION_COOKIE_NAME = 'erplens-session';

/**
 * Non-httpOnly companion carrying ONLY the session's expiry (unix seconds). The client
 * reads it to decide whether it still has a live session without a round trip; it is
 * written, renewed and cleared in lockstep with the session cookie by proxy.ts and never
 * trusted for authorization.
 */
export const SESSION_EXP_COOKIE_NAME = 'erplens-session-exp';

/** Set by the IIS WindowsUserHeaderModule after Windows authentication, e.g. TELMACO\jdoe. */
export const WINDOWS_USER_HEADER = 'x-windows-user';
