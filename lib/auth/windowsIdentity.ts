import { WINDOWS_USER_HEADER } from './constants';

/** Trims and normalises `DOMAIN/user` to `DOMAIN\user`; null when empty or missing. */
export const normalizeWindowsIdentity = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.replaceAll('/', '\\');
};

/**
 * The Windows identity IIS stamped on the request. Trustworthy only because the IIS
 * rewrite rule clears any client-supplied copy first, the managed module re-sets it from
 * the authenticated principal, and Node listens on 127.0.0.1 so nothing but IIS can reach it.
 */
export const getWindowsIdentityFromHeaders = (headers: Headers): string | null =>
  normalizeWindowsIdentity(headers.get(WINDOWS_USER_HEADER));
