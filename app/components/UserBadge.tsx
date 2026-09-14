'use client';

import { useAuth } from './AuthProvider';

/** Who is signed in, at the foot of the nav. Hidden when the rail is collapsed. */
export default function UserBadge({ collapsed }: { collapsed: boolean }) {
  const { user, windowsUserName, authRequired } = useAuth();
  if (collapsed) return null;

  const name = user?.username ?? windowsUserName ?? null;
  const detail = user ? user.domainName ?? windowsUserName : null;

  return (
    <div className="side-nav__user" aria-live="polite">
      <p className="side-nav__user-name">{name ?? 'Not signed in'}</p>
      {detail && detail !== name ? <p className="side-nav__user-detail">{detail}</p> : null}
      {!name && !authRequired ? <p className="side-nav__user-detail">Anonymous access</p> : null}
    </div>
  );
}
