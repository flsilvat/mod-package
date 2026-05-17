import { useState } from 'react';
import { useAuth } from '../lib/auth';

// Turns Firebase's error codes into something readable.
function friendlyError(code) {
  if (code.includes('invalid-credential') || code.includes('wrong-password'))
    return 'Email or password not recognised.';
  if (code.includes('user-not-found')) return 'No account for that email.';
  if (code.includes('too-many-requests'))
    return 'Too many attempts. Wait a moment and try again.';
  if (code.includes('invalid-email')) return 'That email address looks wrong.';
  return 'Could not sign in. Please try again.';
}

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email, password);
      // On success, the auth listener swaps in the app — nothing to do here.
    } catch (err) {
      setError(friendlyError(err.code || ''));
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={handleSubmit}>
        <div className="auth-brand">
          <span className="brand-mark" aria-hidden="true">◆</span>
          <span className="brand-name">MOD&nbsp;PACKAGE</span>
        </div>
        <p className="auth-tagline">Technical order builder · sign in</p>

        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
          />
        </div>

        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>

        {error && <p className="notice notice-error">{error}</p>}

        <button type="submit" className="btn btn-primary auth-submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="auth-help">
          Accounts are created by an administrator. If you can't get in, ask to
          be added.
        </p>
      </form>
    </div>
  );
}
