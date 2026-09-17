'use client';

import { useAuth } from './AuthProvider';

/** `TELMACO\jdoe` or `jdoe@telmaco.gr` -> `jdoe`; anything else passes through. */
const bareUserName = (identity: string): string => {
  const afterBackslash = identity.split('\\').pop() ?? identity;
  return afterBackslash.split('@')[0] || identity;
};

/** Who is signed in, at the foot of the nav. Hidden when the rail is collapsed. */
export default function UserBadge({ collapsed }: { collapsed: boolean }) {
  const { user, windowsUserName, authRequired } = useAuth();
  if (collapsed) return null;

  const raw = user?.username ?? windowsUserName ?? null;
  const name = raw ? bareUserName(raw) : null;
  // Absent when the user has no RoleID, or when only the Windows identity is known (the
  // degraded /api/session path). The line is then dropped rather than shown empty.
  const role = user?.roleName ?? null;

  return (
    <div className="side-nav__user" aria-live="polite">
      <p className="side-nav__user-name">{name ?? 'Not signed in'}</p>
      {role ? <p className="side-nav__user-detail">{role}</p> : null}
      {!name && !authRequired ? <p className="side-nav__user-detail">Anonymous access</p> : null}
    </div>
  );
}
