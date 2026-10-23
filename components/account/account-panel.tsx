'use client';
/* Full-page navigation intentionally resets the account-scoped repository and editor. */
/* eslint-disable @next/next/no-html-link-for-pages */
import { useEffect, useState } from 'react';

type Account = { configured: boolean; user: { id: string; name: string; email: string } | null };

export function AccountPanel() {
  const [account, setAccount] = useState<Account | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    fetch('/api/account', { cache: 'no-store', signal: abort.signal }).then(async response => {
      if (!response.ok) throw new Error();
      const result = await response.json() as Account;
      if (!abort.signal.aborted) { setAccount(result); setError(new URLSearchParams(window.location.search).get('login') === 'failed' ? 'Google sign-in was not completed. Please try again.' : ''); }
    }).catch(() => { if (!abort.signal.aborted) setError('Your account could not be loaded. Please retry.'); });
    return () => abort.abort();
  }, [attempt]);

  async function signIn() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/auth/sign-in/social', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'google', callbackURL: '/account', errorCallbackURL: '/account?login=failed' }),
      });
      if (!response.ok) throw new Error();
      const data = await response.json() as { url?: string };
      if (!data.url) throw new Error();
      const target = new URL(data.url);
      if (target.origin !== 'https://accounts.google.com') throw new Error();
      window.location.assign(target.href);
    } catch { setError('Sign-in could not start. Please retry.'); setBusy(false); }
  }
  async function signOut() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/auth/sign-out', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (!response.ok) throw new Error();
      window.location.replace('/account');
    } catch { setError('Sign-out failed. Please retry.'); setBusy(false); }
  }
  return <main className="account-page">
    <a href="/">← Back to local documents</a>
    <section className="account-card" aria-labelledby="account-title">
      <h1 id="account-title">Your account</h1>
      {error && <p role="alert">{error} <button disabled={busy} onClick={() => setAttempt(value => value + 1)}>Retry</button></p>}
      {!account && !error && <p role="status">Loading account…</p>}
      {account && !account.configured && <p>Sign-in is not available on this address yet. You can continue using your local documents.</p>}
      {account?.configured && (account.user ? <>
        <p>Signed in as <strong>{account.user.name}</strong></p><p>{account.user.email}</p><p><a href="/cloud">Open cloud workspace →</a></p>
        <button className="secondary-button" disabled={busy} onClick={() => void signOut()}>{busy ? 'Signing out…' : 'Sign out'}</button>
      </> : <><p>Use your Google account to sign in to VDoc.</p><button className="secondary-button" disabled={busy} onClick={() => void signIn()}>{busy ? 'Opening Google…' : 'Continue with Google'}</button></>)}
      <p className="account-note">Your local workspace stays in this browser and is shared by people using this browser profile. Open the cloud workspace to sync documents with your account. Existing local files are not uploaded automatically: export a backup, then import it into the cloud workspace.</p>
      <p className="account-note">The voice assistant is available only for cloud documents owned by your signed-in account and outside Trash, on sites where voice is enabled. Connect to the internet, open a cloud document, and click Connect voice assistant to allow microphone access. Voice usage is subject to the service’s quota; remaining allowance is currently unavailable.</p>
    </section>
  </main>;
}
