import { useAuth } from '../lib/auth';

// Shown when someone is signed in but has no userRoles entry yet.
export default function NoAccess() {
  const { user, logout } = useAuth();
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="brand-mark" aria-hidden="true">◆</span>
          <span className="brand-name">MOD&nbsp;PACKAGE</span>
        </div>
        <p className="auth-tagline">Account not yet authorised</p>
        <p className="notice">
          You're signed in as <strong>{user?.email}</strong>, but this account
          hasn't been given access yet. Ask an administrator to add you as an
          admin or a viewer.
        </p>
        <button className="btn btn-ghost auth-submit" onClick={logout}>
          Sign out
        </button>
      </div>
    </div>
  );
}
