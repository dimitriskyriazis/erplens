'use client';

type Props = {
  windowsIdentity?: string | null;
};

/** Shown when Windows authentication succeeded but the account has no row in tlm.Users. */
export default function AccessDeniedPage({ windowsIdentity }: Props) {
  return (
    <div className="auth-screen">
      <div className="auth-screen__card">
        <h1 className="auth-screen__title">Access denied</h1>
        <p className="auth-screen__message">
          You signed in with a domain account that is not authorised for ERPLens.
        </p>
        <p className="auth-screen__message">
          To request access, contact <strong>Dimitris Kyriazis (dim.kyriazis@telmaco.gr)</strong>.
        </p>
        {windowsIdentity && (
          <p className="auth-screen__identity" aria-label="Signed in as">
            Signed in as {windowsIdentity}
          </p>
        )}
      </div>
    </div>
  );
}
