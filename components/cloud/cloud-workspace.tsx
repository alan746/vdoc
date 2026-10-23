'use client';
/* Full-page navigation intentionally resets the account-scoped repository and editor. */
/* eslint-disable @next/next/no-html-link-for-pages */
import { useEffect, useState, useSyncExternalStore } from 'react';
import VdocWorkspace from '../editor/workspace';
import { createCloudWorkspace } from '@/lib/composition/cloud-workspace';

type Workspace = ReturnType<typeof createCloudWorkspace>;
export function CloudWorkspace() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [error, setError] = useState('');
  const [resolve, setResolve] = useState(false);
  useEffect(() => {
    let live = true; let stop: (() => void) | undefined;
    fetch('/api/account', { cache: 'no-store' }).then(async response => {
      if (!response.ok) throw new Error('Account could not be verified. Connect and retry.');
      const account = await response.json() as { configured: boolean; user: { id: string } | null };
      if (!account.configured || !account.user) throw new Error('Sign in before opening your cloud workspace.');
      if (!live) return;
      const repositories = createCloudWorkspace(account.user.id);
      stop = repositories.start(); setResolve(new URLSearchParams(window.location.search).get('resolve') === '1'); setWorkspace(repositories);
    }).catch(error => { if (live) setError(error instanceof Error ? error.message : 'Cloud workspace unavailable.'); });
    return () => { live = false; stop?.(); };
  }, []);
  if (error) return <main className="account-page"><h1>Cloud workspace</h1><p role="alert">{error}</p><p><a href="/account">Open account</a> · <a href="/">Open local documents</a></p></main>;
  if (!workspace) return <main className="account-page" role="status">Opening cloud workspace…</main>;
  return <><CloudStatus workspace={workspace} resolve={resolve} />{!resolve && <VdocWorkspace />}</>;
}
function CloudStatus({ workspace, resolve }: { workspace: Workspace; resolve: boolean }) {
  const state = useSyncExternalStore(workspace.subscribe, workspace.getSnapshot, workspace.getSnapshot);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const action = async (work: () => Promise<void>) => { setBusy(true); setError(''); try { await work(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not complete this action.'); } finally { setBusy(false); } };
  const download = async (id: string) => {
    const document = await workspace.exportPending(id);
    const url = URL.createObjectURL(new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' }));
    const link = window.document.createElement('a'); link.href = url; link.download = `${document.title || 'Document'}-local-copy.vdoc.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <section className={resolve ? 'account-page' : 'cloud-sync-bar'} aria-label="Cloud sync status">
    <strong>Cloud workspace</strong><span role="status">{state.conflicts.length ? `${state.conflicts.length} sync conflict(s). Local copies are preserved.` : state.message || (state.pending ? `${state.pending} document(s) saved locally, waiting to sync` : state.status === 'syncing' ? 'Checking cloud sync…' : 'Cloud sync up to date')}</span>
    <button disabled={busy} onClick={() => void action(workspace.sync)}>Retry sync</button>
    <a href="/account">Account</a><a href="/">Local workspace</a>
    {!resolve && state.conflicts.length > 0 && <a href="/cloud?resolve=1">Resolve conflicts</a>}
    {resolve && <>
      <h1>Resolve cloud conflicts</h1><p>Download the local copy first to keep both versions. Choosing the cloud copy discards this account’s pending local edits for that document.</p>
      {state.conflicts.map(id => <div className="account-card" key={id}><p>Document {id}</p>
        <button disabled={busy} onClick={() => void action(() => download(id))}>Download local copy</button>{' '}
        <button disabled={busy || state.status === 'account-changed'} onClick={() => { if (window.confirm('Discard the pending local edits for this document and use its cloud version? Download your local copy first if you want to keep it.')) void action(() => workspace.useCloudCopy(id)); }}>Use cloud copy</button>
      </div>)}<p><a href="/cloud">Return to cloud documents</a></p>
    </>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
