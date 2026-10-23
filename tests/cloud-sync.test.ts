// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { IDBFactory } from 'fake-indexeddb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations } from '../scripts/neon-migrations.mjs';
import { handleLibraryRequest } from '../lib/infrastructure/cloud-library/http';
import type { SqlClient } from '../lib/infrastructure/cloud-library/store';
import { CloudRepositories } from '../lib/infrastructure/cloud-sync/repositories';

const pg = new PGlite();
const origin = 'https://vdoc.example';
const content = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const draft = (title: string) => ({ version: 1 as const, title, savedAt: new Date().toISOString(), content: content(title) });
const clients: CloudRepositories[] = [];
function device(owner: string, factory = new IDBFactory()) {
  const state = { offline: false, account: owner as string | null, loseResponse: false, beforeResponse: undefined as undefined | (() => Promise<void>), beforeReadResponse: undefined as undefined | (() => Promise<void>) };
  const fetcher: typeof fetch = async (input, init) => {
    if (state.offline) throw new TypeError('Network offline');
    const url = new URL(String(input), origin), headers = new Headers(init?.headers); headers.set('origin', origin);
    const [, id, versions] = url.pathname.split('/api/library')[1].split('/');
    const response = await handleLibraryRequest(new Request(url, { ...init, headers }), {
      getUser: async () => state.account ? { userId: state.account } : null,
      database: (account, write, work) => pg.transaction(async tx => {
        if (write) await tx.query('select id from app_user where id=$1 for update', [account]);
        return work(tx as SqlClient);
      }),
    }, id || undefined, versions === 'versions');
    if (init?.method === 'GET' && state.beforeReadResponse) { const callback = state.beforeReadResponse; state.beforeReadResponse = undefined; await callback(); }
    if (init?.method === 'POST' && response.ok) {
      if (state.beforeResponse) { const callback = state.beforeResponse; state.beforeResponse = undefined; await callback(); }
      if (state.loseResponse) { state.loseResponse = false; throw new TypeError('Response lost'); }
    }
    return response;
  };
  const repo = new CloudRepositories(owner, fetcher, factory); clients.push(repo);
  return { repo, state, factory };
}
const settle = async (repo: CloudRepositories) => { await repo.sync(); await repo.sync(); };
beforeAll(async () => {
  await applyMigrations(pg);
  await pg.exec("insert into app_user(id,name,email) values ('alice','Alice','alice@example.test'),('bob','Bob','bob@example.test')");
});
afterAll(async () => { for (const client of clients) await client.cache.close(); await pg.close(); });

describe('cloud workspace through the real document API and PostgreSQL engine', () => {
  it('keeps offline edits across cache reopen and syncs them when connected', async () => {
    const a = device('alice'); const doc = await a.repo.library.createDocument(draft('Offline'), null);
    a.state.offline = true; await a.repo.documents.save('Offline edit', content('offline'), doc.id); await settle(a.repo);
    expect(a.repo.getSnapshot()).toMatchObject({ status: 'offline', pending: 1 });
    const reopened = device('alice', a.factory); reopened.state.offline = true;
    expect((await reopened.repo.documents.select(doc.id)).title).toBe('Offline edit');
    reopened.state.offline = false; await settle(reopened.repo);
    expect(reopened.repo.getSnapshot().pending).toBe(0);
    expect((await device('alice').repo.documents.select(doc.id)).title).toBe('Offline edit');
  });
  it('does not increment cloud revisions for unchanged editor autosaves', async () => {
    const { repo } = device('alice'); const doc = await repo.library.createDocument(draft('Unchanged'), null);
    await repo.documents.save(doc.title, doc.content, doc.id); await settle(repo);
    expect((await repo.cache.get(doc.id))?.item.revision).toBe(1);
  });
  it('preserves a conflicting local copy instead of overwriting another device', async () => {
    const a = device('alice'), b = device('alice'); const doc = await a.repo.library.createDocument(draft('Conflict'), null);
    await b.repo.documents.select(doc.id);
    b.state.offline = true; await b.repo.documents.save('B offline', content('B'), doc.id); await settle(b.repo);
    await a.repo.documents.save('A won', content('A'), doc.id); await settle(a.repo);
    b.state.offline = false; await settle(b.repo);
    expect(b.repo.getSnapshot().conflicts).toContain(doc.id);
    expect((await b.repo.exportPending(doc.id)).title).toBe('B offline');
    expect((await device('alice').repo.documents.select(doc.id)).title).toBe('A won');
    await b.repo.useCloudCopy(doc.id);
    expect(b.repo.getSnapshot().pending).toBe(0);
    expect((await b.repo.documents.select(doc.id)).title).toBe('A won');
  });
  it('reconciles a committed write whose response was lost without writing again', async () => {
    const a = device('alice'); const doc = await a.repo.library.createDocument(draft('Lost response'), null);
    a.state.loseResponse = true; await a.repo.documents.save('Committed', content('saved'), doc.id); await settle(a.repo);
    expect(a.repo.getSnapshot().pending).toBe(0);
    expect((await a.repo.cache.get(doc.id))?.item.revision).toBe(2);
  });
  it('keeps edits made during an upload and sends them against the new revision', async () => {
    const a = device('alice'); const doc = await a.repo.library.createDocument(draft('Inflight'), null);
    a.state.beforeResponse = async () => { await a.repo.documents.save('Newer typing', content('newer'), doc.id); };
    await a.repo.documents.save('First edit', content('first'), doc.id); await settle(a.repo);
    expect((await device('alice').repo.documents.select(doc.id)).title).toBe('Newer typing');
    expect(a.repo.getSnapshot().pending).toBe(0);
  });
  it('blocks stale same-browser tab saves before they replace a pending local copy', async () => {
    const a = device('alice'), b = device('alice', a.factory); const doc = await a.repo.library.createDocument(draft('Tabs'), null);
    await b.repo.documents.select(doc.id); a.state.offline = true; b.state.offline = true;
    await a.repo.documents.save('First tab', content('first'), doc.id); await settle(a.repo);
    await expect(b.repo.documents.save('Stale tab', content('stale'), doc.id)).rejects.toThrow('Another tab');
    expect((await a.repo.exportPending(doc.id)).title).toBe('First tab');
  });
  it('rejects a switched login and never transfers pending data to the new account', async () => {
    const a = device('alice'); const doc = await a.repo.library.createDocument(draft('Account guard'), null);
    a.state.account = 'bob'; await a.repo.documents.save('Alice private edit', content('private'), doc.id); await settle(a.repo);
    expect(a.repo.getSnapshot()).toMatchObject({ status: 'account-changed', pending: 1 });
    expect((await a.repo.exportPending(doc.id)).title).toBe('Alice private edit');
    const b = device('bob', a.factory);
    expect(await b.repo.cache.get(doc.id)).toBeUndefined();
    await expect(b.repo.documents.select(doc.id)).rejects.toThrow('not available');
    expect((await pg.query('select id from library_item where owner_id=$1 and id=$2', ['bob', doc.id])).rows).toHaveLength(0);
  });
  it('never resurrects a remotely deleted document; its offline edit can still be exported', async () => {
    const a = device('alice'), b = device('alice'); const doc = await a.repo.library.createDocument(draft('Delete race'), null);
    await b.repo.documents.select(doc.id); b.state.offline = true;
    await b.repo.documents.save('Keep me', content('offline copy'), doc.id); await settle(b.repo);
    const meta = await a.repo.library.update(doc.id, { trash: true });
    await a.repo.library.deleteTrashed(doc.id, meta.trash!);
    b.state.offline = false; await settle(b.repo);
    expect(b.repo.getSnapshot().conflicts).toContain(doc.id);
    expect((await b.repo.exportPending(doc.id)).title).toBe('Keep me');
    await expect(device('alice').repo.documents.select(doc.id)).rejects.toThrow('not available');
  });
  it('uses server checkpoints and retains a backup when restoring', async () => {
    const { repo } = device('alice'); const folder = await repo.library.createFolder('Folder', null);
    const doc = await repo.library.createDocument(draft('Original'), folder);
    const version = await repo.versions.save(doc, 'Original checkpoint');
    const changed = await repo.documents.save('Changed', content('changed'), doc.id); await settle(repo);
    const restored = await repo.versions.restore(version.key, changed);
    expect(restored.title).toBe('Original');
    expect((await repo.versions.list(doc.id)).map(v => v.label)).toContain('Before restore');
    const library = await repo.library.list();
    expect(library.find(i => i.id === doc.id)?.parentId).toBe(folder);
  });
  it('does not discard a newer local edit made while conflict resolution was fetching', async () => {
    const a = device('alice'), b = device('alice', a.factory);
    const doc = await a.repo.library.createDocument(draft('Resolution race'), null);
    await b.repo.documents.select(doc.id); a.state.offline = true;
    await a.repo.documents.save('Pending', content('pending'), doc.id); await settle(a.repo);
    // Load the pending copy in the other tab, then type while resolution is waiting.
    await b.repo.documents.select(doc.id); b.state.offline = true; a.state.offline = false;
    a.state.beforeReadResponse = async () => { await b.repo.documents.save('Newest local', content('newest'), doc.id); await settle(b.repo); };
    await expect(a.repo.useCloudCopy(doc.id)).rejects.toThrow('Another tab edited');
    expect((await a.repo.exportPending(doc.id)).title).toBe('Newest local');
  });
  it('rejects a failed cache transaction rather than claiming the document was saved', async () => {
    const a = device('alice'); const doc = await a.repo.library.createDocument(draft('Storage closed'), null);
    await a.repo.cache.close();
    await expect(a.repo.documents.save('Unsaved', content('unsaved'), doc.id)).rejects.toThrow();
    expect((await device('alice').repo.documents.select(doc.id)).title).toBe('Storage closed');
  });

});
