'use client';
/* Full-page navigation intentionally resets the account-scoped repository and editor. */
/* eslint-disable @next/next/no-html-link-for-pages */
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Cloud, HardDrive, LoaderCircle, LogOut, UserRound } from 'lucide-react';
import { isCloudWorkspace } from '@/lib/composition/repositories';

type Account = { configured: boolean; user: { id: string; name: string; email: string } | null };
const initial = (user: Account['user']) => (user ? (user.name.trim() || user.email).slice(0, 1).toUpperCase() : 'V');

/** Avatar in the library top bar: clicking opens the account page; hovering (or keyboard focus) reveals the account card. */
export function AccountMenu() {
  const [account, setAccount] = useState<Account | null>(null);
  const [checking, setChecking] = useState(true);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [cloud] = useState(isCloudWorkspace);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const abort = new AbortController();
    fetch('/api/account', { cache: 'no-store', signal: abort.signal })
      .then(async response => { const result = await response.json() as Account; if (typeof result.configured === 'boolean') setAccount(result); })
      .catch(() => { /* The card falls back to the signed-out view. */ })
      .finally(() => { if (!abort.signal.aborted) setChecking(false); });
    return () => { abort.abort(); clearTimeout(closeTimer.current); };
  }, []);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent | PointerEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !root.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', close); window.addEventListener('pointerdown', close);
    return () => { window.removeEventListener('keydown', close); window.removeEventListener('pointerdown', close); };
  }, [open]);
  const show = () => { clearTimeout(closeTimer.current); setOpen(true); };
  const hide = () => { clearTimeout(closeTimer.current); closeTimer.current = setTimeout(() => setOpen(false), 160); };
  async function signOut() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/auth/sign-out', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error();
      window.location.replace('/account');
    } catch { setError('Sign-out failed. Please try again.'); setBusy(false); }
  }
  const user = account?.user ?? null;
  return <div ref={root} className="account-menu" data-open={open} onPointerEnter={event => { if (event.pointerType === 'mouse') show(); }} onPointerLeave={event => { if (event.pointerType === 'mouse') hide(); }} onFocus={show} onBlur={event => { if (!root.current?.contains(event.relatedTarget as Node)) hide(); }}>
    <a className="library-person" href="/account" aria-label="Your account">{initial(user)}</a>
    {open && <div className="account-card-pop" role="dialog" aria-label="Account">
      <div className="account-pop-head">
        <span className="account-pop-avatar" aria-hidden="true">{initial(user)}</span>
        <div className="account-pop-who">
          {checking ? <><strong>Checking your account…</strong><span><LoaderCircle size={12} className="signin-spinner" />One moment</span></>
            : user ? <><strong title={user.name}>{user.name || 'Your account'}</strong><span title={user.email}>{user.email}</span></>
            : <><strong>Writing locally</strong><span>Not signed in</span></>}
        </div>
      </div>
      <div className="account-pop-place"><span className="account-pop-dot" />{cloud ? <><Cloud size={14} />Cloud workspace · synced to your account</> : <><HardDrive size={14} />Local workspace · saved in this browser</>}</div>
      <nav className="account-pop-links" aria-label="Account">
        {user ? <>
          {cloud ? <a href="/"><HardDrive size={16} /><span>Local documents<small>Files saved in this browser</small></span></a>
            : <a href="/cloud"><Cloud size={16} /><span>Cloud workspace<small>Your documents on every device</small></span><ArrowUpRight size={14} /></a>}
          <a href="/account"><UserRound size={16} /><span>Account<small>Profile and sign-in</small></span></a>
        </> : <>
          <a className="account-pop-primary" href="/account"><Cloud size={16} /><span>Sign in to VDoc<small>Keep documents in your cloud workspace</small></span><ArrowUpRight size={14} /></a>
          {cloud && <a href="/"><HardDrive size={16} /><span>Local documents<small>Files saved in this browser</small></span></a>}
        </>}
      </nav>
      {error && <p className="account-pop-error" role="alert">{error}</p>}
      {user && <button type="button" className="account-pop-signout" disabled={busy} onClick={() => void signOut()}>{busy ? <LoaderCircle size={15} className="signin-spinner" /> : <LogOut size={15} />}{busy ? 'Signing out…' : 'Sign out'}</button>}
    </div>}
  </div>;
}
