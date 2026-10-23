'use client';
/* Full-page navigation resets the account-scoped repository and editor. */
/* eslint-disable @next/next/no-html-link-for-pages */
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Cloud, FileText, LoaderCircle, RefreshCw, ShieldCheck } from 'lucide-react';

type Account = { configured: boolean; user: { id: string; name: string; email: string } | null; error?: { code?: string }; signInUrl?: string };
const unavailableMessage = (code?: string) => code === 'AUTH_NOT_CONFIGURED'
  ? 'Sign-in setup is incomplete. Check again in a moment, or keep writing in your local workspace.'
  : code === 'ORIGIN_MISMATCH' ? 'Sign-in is available on the main VDoc website. Continue there to access your account.'
  : 'We couldn’t connect to your account. Check your connection and try again.';

function GoogleMark() {
  return <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24"><path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.36Z"/><path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.05.97-3.38.97-2.6 0-4.8-1.76-5.58-4.12H3.08v2.59A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.42 13.93a6 6 0 0 1 0-3.86V7.48H3.08a10 10 0 0 0 0 9.04l3.34-2.59Z"/><path fill="#EA4335" d="M12 5.95c1.47 0 2.79.5 3.83 1.5l2.88-2.88A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.92 5.48l3.34 2.59C7.2 7.71 9.4 5.95 12 5.95Z"/></svg>;
}

export function AccountPanel() {
  const [account, setAccount] = useState<Account | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false), [checking, setChecking] = useState(true);
  const pending = useRef(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const abort = new AbortController(); let disposed = false;
    const timeout = setTimeout(() => abort.abort(), 15000);
    fetch('/api/account', { cache: 'no-store', signal: abort.signal }).then(async response => {
      const result = await response.json() as Account;
      if (typeof result.configured !== 'boolean') throw new Error();
      if (disposed || abort.signal.aborted) return;
      if (!response.ok || !result.configured) {
        setAccount({ ...result, configured: false, user: null });
        setError(unavailableMessage(result.error?.code));
      } else {
        setAccount(result);
        setError(new URLSearchParams(window.location.search).get('login') === 'failed' ? 'Google sign-in wasn’t completed. Please try again.' : '');
      }
    }).catch(() => { if (!disposed) setError('We couldn’t connect to your account. Check your connection and try again.'); })
      .finally(() => { clearTimeout(timeout); if (!disposed) setChecking(false); });
    return () => { disposed = true; clearTimeout(timeout); abort.abort(); };
  }, [attempt]);

  const checkAgain = () => { setChecking(true); setError(''); setAccount(null); setAttempt(value => value + 1); };

  async function signIn() {
    if (pending.current || checking) return;
    pending.current = true; setBusy(true); setError('');
    try {
      const response = await fetch('/api/auth/sign-in/social', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000),
        body: JSON.stringify({ provider: 'google', callbackURL: '/account', errorCallbackURL: '/account?login=failed' }),
      });
      if (!response.ok) throw new Error();
      const data = await response.json() as { url?: string };
      if (!data.url) throw new Error();
      const target = new URL(data.url);
      if (target.origin !== 'https://accounts.google.com') throw new Error();
      window.location.assign(target.href);
    } catch { setError('Google sign-in couldn’t start. Please try the button again.'); pending.current = false; setBusy(false); }
  }
  async function signOut() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try {
      const response = await fetch('/api/auth/sign-out', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error();
      window.location.replace('/account');
    } catch { setError('Sign-out failed. Please try again.'); pending.current = false; setBusy(false); }
  }
  const user = account?.user;
  const unavailable = !checking && !account?.configured;
  return <main className="signin-page">
    <header className="signin-nav"><a className="signin-wordmark" href="/" aria-label="VDoc home">vdoc<span>.</span></a><a className="signin-back" href="/"><ArrowLeft size={16} />Local documents</a></header>
    <div className="signin-layout">
      <section className="signin-story" aria-labelledby="signin-story-title">
        <span className="signin-eyebrow">A LITTLE ROOM TO THINK</span>
        <h1 id="signin-story-title">Your words,<br /><em>wherever you are.</em></h1>
        <p>A quiet space to write. A familiar place to return to.<br className="signin-desktop-break" /> Bring your cloud documents along, on any device.</p>
        <div className="signin-illustration" aria-hidden="true"><div className="signin-paper"><FileText size={25} strokeWidth={1.4} /><span>A thought worth keeping.</span><i /><i /><i /><i /></div><div className="signin-cloud-tag"><Cloud size={17} />A workspace that goes with you</div></div>
        <div className="signin-story-foot"><ShieldCheck size={17} /><span>Your cloud documents stay with your account.</span></div>
      </section>
      <section className="signin-card" aria-labelledby="account-title">
        <div className="signin-card-icon"><Cloud size={25} strokeWidth={1.5} /></div>
        <span className="signin-eyebrow">YOUR ACCOUNT</span>
        <h2 id="account-title">{user ? 'Welcome back.' : unavailable ? 'Let’s reconnect.' : 'Welcome to VDoc.'}</h2>
        <p className="signin-intro">{user ? 'Your next idea is waiting. Pick up where you left off in your cloud workspace.' : 'Sign in to keep your cloud documents together, from desktop to phone.'}</p>
        {error && <div role="alert" className="signin-alert">{error}</div>}
        {checking && <div className="signin-loading" role="status"><LoaderCircle size={19} className="signin-spinner" />Checking your account…</div>}
        {!checking && user && <>
          <div className="signin-identity"><span aria-hidden="true">{(user.name.trim() || user.email).slice(0, 1).toUpperCase()}</span><div><strong>{user.name}</strong><p>{user.email}</p></div></div>
          <a className="signin-primary" href="/cloud">Open cloud workspace <ArrowRight size={18} /></a>
          <button className="signin-text-button" disabled={busy} onClick={() => void signOut()}>{busy ? 'Signing out…' : 'Sign out'}</button>
        </>}
        {!checking && account?.configured && !user && <><button className="signin-google" disabled={busy} onClick={() => void signIn()}>{busy ? <LoaderCircle size={20} className="signin-spinner" /> : <GoogleMark />}{busy ? 'Opening Google…' : 'Continue with Google'}{!busy && <ArrowRight size={17} />}</button><p className="signin-reassurance">One account. Your own cloud workspace.</p></>}
        {unavailable && <>
          {account?.error?.code === 'ORIGIN_MISMATCH' && account.signInUrl?.startsWith('https://') && <a className="signin-primary" href={account.signInUrl}>Open sign-in website <ArrowRight size={17} /></a>}
          <button className="signin-retry" disabled={busy || checking} onClick={checkAgain}><RefreshCw size={17} />Check again</button>
        </>}
        <div className="signin-divider"><span>or keep it local</span></div>
        <a className="signin-local" href="/">Continue with local documents <ArrowRight size={16} /></a>
        <p className="signin-local-note">No account needed. Saved in this browser.</p>
        <details className="signin-details"><summary>About your workspace</summary><p>Local documents stay in this browser and are shared by people using this browser profile. Signing in doesn’t upload them automatically. Export a backup, then import it into your cloud workspace.</p><p>Voice editing is available for your active cloud documents when enabled. Open a cloud document and connect the voice assistant to allow microphone access. An internet connection is required; usage limits apply and remaining allowance is not yet shown.</p></details>
      </section>
    </div>
    <footer className="signin-footer"><span>VDOC / YOUR WORDS, YOUR SPACE</span><span>Made for a little more clarity.</span></footer>
  </main>;
}
