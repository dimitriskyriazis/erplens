/**
 * Whether proxy.ts rejects API calls that carry no valid session.
 *
 * AUTH_REQUIRE_SESSION=true|false wins when set. Unset, production is closed and
 * development is open, so a forgotten variable can never leave the live site anonymous.
 * Set it to false on the server only as a deliberate rollback while the IIS side is fixed.
 */
export const isAuthRequired = (): boolean => {
  const raw = process.env.AUTH_REQUIRE_SESSION?.trim();
  if (raw) return raw === 'true';
  return process.env.NODE_ENV === 'production';
};

/**
 * Development only: `next dev` has no IIS in front to stamp X-Windows-User, so this
 * identity is used instead and resolved through tlm.Users like any other. Dead under
 * `next start` (NODE_ENV=production), so it can never be a bypass in prod.
 */
export const devWindowsIdentity = (): string | null => {
  if (process.env.NODE_ENV === 'production') return null;
  const value = process.env.DEV_AUTO_WINDOWS_USER?.trim();
  return value || null;
};
