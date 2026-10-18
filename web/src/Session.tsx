import { useEffect, useRef, useState, type ReactNode } from 'react';
import { onUnauthorized, request, type StaffSession } from './api';
import { tenantSlug } from './Tenant';

export function SessionGate({ children }: { children: (session: StaffSession, logout: () => Promise<void>, expired: boolean, passwordChanged: () => void) => ReactNode }) {
  const [session, setSession] = useState<StaffSession | null>(null);
  const current = useRef<StaffSession | null>(null);
  const [expired, setExpired] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => onUnauthorized(token => {
    if (current.current?.accessToken === token) { setExpired(true); setMessage('Your session expired or was revoked. Sign in again. Pending checkout IDs are preserved.'); }
  }), []);
  useEffect(() => {
    if (!session) return;
    const timer = window.setTimeout(() => { setExpired(true); setMessage('Your shift session expired. Sign in again to continue.'); }, Math.max(0, Date.parse(session.expiresAt) - Date.now()));
    return () => window.clearTimeout(timer);
  }, [session?.accessToken]);
  async function login() {
    if (busy) return;
    setBusy(true); setMessage('');
    try {
      const value = await request<StaffSession>('', '/auth/login', { username, password });
      current.current = value; setSession(value); setExpired(false); setPassword('');
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Could not sign in.'); }
    finally { setBusy(false); }
  }
  async function logout() {
    const value = current.current;
    try { if (value) await request(value.accessToken, '/auth/logout', {}); setMessage('Signed out.'); }
    catch { setMessage('Signed out on this device. Server-side revocation could not be confirmed; the session still has an expiry.'); }
    finally { current.current = null; setSession(null); setExpired(false); setPassword(''); }
  }
  function passwordChanged() { setExpired(true); setMessage('Password changed. All sessions were revoked; sign in with the new password.'); }
  return <>
    {session && <div hidden={expired}>{children(session, logout, expired, passwordChanged)}</div>}
    {(!session || expired) && <main className="identity-page"><a className="identity-brand" href="/">c. counterline</a><section className="connect-panel"><span className="eyebrow">ONE RESTAURANT. ONE CONNECTED WORKSPACE.</span><h2>Welcome to {tenantSlug}.</h2><p><a href="/">Switch business workspace</a></p><p>Sign in with your individual staff account. First owner credentials are in <code>pos/.env</code>; the shared staff token is no longer accepted.</p><form onSubmit={event => { event.preventDefault(); void login(); }}><label htmlFor="username">Username</label><input id="username" autoComplete="username" value={username} maxLength={32} onChange={event => setUsername(event.target.value)} required disabled={busy}/><label htmlFor="password">Password</label><input id="password" type="password" autoComplete="current-password" value={password} maxLength={128} onChange={event => setPassword(event.target.value)} required disabled={busy}/><button className="primary full" disabled={busy || !username.trim() || !password}>{busy ? 'Signing in…' : 'Sign in →'}</button></form><small>Session credentials stay in memory, expire after 8 hours and can be revoked by an owner.</small>{message && <p className="error" role="status">{message}</p>}</section></main>}
  </>;
}

export function PasswordView({ token, onChanged }: { token: string; onChanged: () => void }) {
  const [current, setCurrent] = useState(''); const [next, setNext] = useState(''); const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function save() {
    setError('');
    if (next !== confirmation) { setError('New passwords do not match.'); return; }
    setBusy(true);
    try { await request(token, '/auth/password', { currentPassword: current, newPassword: next }); setCurrent(''); setNext(''); setConfirmation(''); onChanged(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not change password.'); }
    finally { setBusy(false); }
  }
  return <section className="workspace"><div className="workspace-heading"><div><span className="eyebrow">YOUR ACCOUNT</span><h2>Change your password.</h2><p>Use a unique password of 12–128 characters. Changing it signs out all your devices.</p></div></div><form className="admin-form narrow-form" onSubmit={event => { event.preventDefault(); void save(); }}><label>Current password<input type="password" autoComplete="current-password" value={current} onChange={event => setCurrent(event.target.value)} required maxLength={128}/></label><label>New password<input type="password" autoComplete="new-password" value={next} onChange={event => setNext(event.target.value)} required minLength={12} maxLength={128}/></label><label>Confirm new password<input type="password" autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)} required minLength={12} maxLength={128}/></label>{error && <p className="error" role="alert">{error}</p>}<button className="primary" disabled={busy}>{busy ? 'Changing…' : 'Change password & sign out'}</button></form></section>;
}
