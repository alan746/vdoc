// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations } from '../scripts/neon-migrations.mjs';
import { handleLibraryRequest, type LibraryDependencies } from '../lib/infrastructure/cloud-library/http';
import { type CloudItem, type SqlClient } from '../lib/infrastructure/cloud-library/store';
import { proxyVoiceSession } from '../lib/infrastructure/realtime/voice-session-proxy';
import { authorizeVoiceDocument } from '../lib/infrastructure/cloud-library/voice-access';

const pg = new PGlite();
const origin = 'https://vdoc.example';
const doc = (id: string, title = id, parentId: string | null = null) => ({ action: 'put', id, expectedRevision: 0, kind: 'document', title, parentId, starred: false, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: title }] }] }, formatVersion: 1 });
const folder = (id: string, parentId: string | null = null) => ({ ...doc(id, id, parentId), kind: 'folder', content: null, formatVersion: null });
function deps(owner: string | null): LibraryDependencies {
  return {
    getUser: async () => owner ? { userId: owner } : null,
    database: async (_owner, write, work) => pg.transaction(async tx => {
      if (write) await tx.query('select id from app_user where id=$1 for update', [_owner]);
      return work(tx as SqlClient);
    }),
  };
}
async function call(owner: string | null, body?: unknown, id?: string, versions = false, extraHeaders = {}) {
  return handleLibraryRequest(new Request(`${origin}/api/library`, { method: body ? 'POST' : 'GET', headers: {
    origin, 'content-type': 'application/json', 'x-vdoc-account': owner || '', ...extraHeaders,
  }, ...(body ? { body: JSON.stringify(body) } : {}) }), deps(owner), id, versions);
}
async function put(owner: string, body: unknown) {
  const response = await call(owner, body);
  const result = await response.json() as { item: CloudItem; error?: unknown };
  expect(response.status, JSON.stringify(result)).toBe(200);
  return result.item;
}
beforeAll(async () => {
  await applyMigrations(pg);
  await pg.exec("insert into app_user(id,name,email) values ('alice','Alice','alice@example.test'),('bob','Bob','bob@example.test')");
});
afterAll(() => pg.close());

describe('authenticated Neon document API', () => {
  it('requires verified login, same-origin writes and the current account guard', async () => {
    expect((await call(null)).status).toBe(401);
    expect((await call('alice', doc('blocked'), undefined, false, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await call('bob', doc('blocked'), undefined, false, { 'x-vdoc-account': 'alice' })).status).toBe(409);
    expect((await call('alice', { ...doc('blocked'), ownerId: 'bob' })).status).toBe(400);
    expect((await pg.query('select id from library_item')).rows).toHaveLength(0);
  });
  it('allows identical local IDs for different owners without sharing content', async () => {
    await put('alice', doc('same-id', 'Alice private'));
    await put('bob', doc('same-id', 'Bob private'));
    for (const owner of ['alice', 'bob']) {
      const response = await call(owner, undefined, 'same-id');
      expect((await response.json() as { item: CloudItem }).item.title.toLowerCase()).toContain(owner);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
    }
    await put('alice', doc('alice-only'));
    expect((await call('bob', undefined, 'alice-only')).status).toBe(404);
    expect((await call('bob', { action: 'delete', id: 'alice-only', expectedRevision: 1 })).status).toBe(404);
    expect((await call('bob', undefined, 'alice-only', true)).status).toBe(404);
  });
  it('validates document structures and rejects future versions or folder bodies', async () => {
    for (const body of [
      { ...doc('invalid'), content: { type: 'script' } },
      { ...doc('invalid'), content: { type: 'doc', content: [{ type: 'unknown' }] } },
      { ...doc('invalid'), formatVersion: 999 },
      { ...folder('invalid'), content: {} },
      { ...doc('invalid'), title: ' ' },
    ]) expect((await call('alice', body)).status).toBe(400);
  });
  it('enforces owner-scoped parents and prevents folder cycles', async () => {
    await put('alice', folder('parent'));
    await put('alice', folder('child', 'parent'));
    expect((await call('bob', folder('escape', 'parent'))).status).toBe(404);
    expect((await call('alice', { ...folder('parent', 'child'), expectedRevision: 1 })).status).toBe(400);
    expect((await call('alice', { ...folder('child', 'child'), expectedRevision: 1 })).status).toBe(400);
    expect((await call('alice', doc('bad-parent', 'Bad', 'same-id'))).status).toBe(400);
  });
  it('accepts only one of two writes based on the same revision, preserving the winner', async () => {
    await put('alice', doc('race'));
    const results = await Promise.all(['first', 'second'].map(title => call('alice', { ...doc('race', title), expectedRevision: 1 })));
    expect(results.map(r => r.status).sort()).toEqual([200, 409]);
    const winner = await results.find(r => r.status === 200)!.json() as { item: CloudItem };
    const stored = await (await call('alice', undefined, 'race')).json() as { item: CloudItem };
    expect(stored.item.title).toBe(winner.item.title);
    expect(stored.item.revision).toBe(2);
    expect((await call('alice', doc('race'))).status).toBe(409);
  });
  it('trashes/restores a subtree but preserves earlier independent trash', async () => {
    await put('alice', doc('live', 'Live', 'child'));
    await put('alice', doc('discarded', 'Old trash', 'child'));
    await put('alice', { action: 'trash', id: 'discarded', expectedRevision: 1 });
    const trashed = await put('alice', { action: 'trash', id: 'parent', expectedRevision: 1 });
    expect(trashed.trashGroup).toBeTruthy();
    expect((await call('alice', { ...doc('live'), expectedRevision: 2 })).status).toBe(409);
    expect((await call('alice', folder('new-child', 'parent'))).status).toBe(400);
    await put('alice', { action: 'restore', id: 'parent', expectedRevision: trashed.revision });
    const live = await (await call('alice', undefined, 'live')).json() as { item: CloudItem };
    const discarded = await (await call('alice', undefined, 'discarded')).json() as { item: CloudItem };
    expect(live.item.trashedAt).toBeNull();
    expect(discarded.item.trashedAt).not.toBeNull();
  });
  it('captures and restores owner-scoped history and rejects stale restores', async () => {
    await put('alice', { action: 'checkpoint', id: 'same-id', expectedRevision: 1, versionId: 'v1', label: 'Original' });
    await put('bob', { action: 'checkpoint', id: 'same-id', expectedRevision: 1, versionId: 'v1', label: 'Bob original' });
    await put('alice', { ...doc('same-id', 'New content'), expectedRevision: 2 });
    expect((await call('alice', { action: 'restoreVersion', id: 'same-id', expectedRevision: 2, versionId: 'v1' })).status).toBe(409);
    const restored = await put('alice', { action: 'restoreVersion', id: 'same-id', expectedRevision: 3, versionId: 'v1' });
    expect(restored.title).toBe('Alice private');
    expect(restored.revision).toBe(4);
    expect((await pg.query("select id from document_version where owner_id='alice' and label='Before restore'")).rows).toHaveLength(1);
    const response = await call('bob', undefined, 'same-id', true);
    expect(JSON.stringify(await response.json())).toContain('Bob original');
  });
  it('uses different voice rooms for two owners of the same local document ID', async () => {
    const alice = await authorizeVoiceDocument(pg as SqlClient, 'alice', 'same-id');
    const bob = await authorizeVoiceDocument(pg as SqlClient, 'bob', 'same-id');
    expect(alice).toMatch(/^u_[a-f0-9]{64}$/);
    expect(alice).not.toBe(bob);
    expect(await authorizeVoiceDocument(pg as SqlClient, 'bob', 'alice-only')).toBeNull();
    expect(await authorizeVoiceDocument(pg as SqlClient, 'alice', 'discarded')).toBeNull();
    expect(await authorizeVoiceDocument(pg as SqlClient, 'alice', 'parent')).toBeNull();
  });
  it('sends the live account and its own cloud room on every voice lifecycle request', async () => {
    for (const owner of ['alice', 'bob']) await put(owner, doc('voice-imported-id'));
    const calls: { user: string | null; requestId: string | null; url: string }[] = [];
    const key = 'server-only-voice-application-key';
    for (const owner of ['alice', 'bob']) {
      const transport = await authorizeVoiceDocument(pg as SqlClient, owner, 'voice-imported-id');
      for (const action of ['create', 'grant', 'end'] as const) {
        const result = await proxyVoiceSession(new Request(`${origin}/api/voice-sessions`, {
          method: action === 'end' ? 'DELETE' : 'POST',
          headers: { origin, 'content-type': 'application/json', 'x-vdoc-user-id': owner === 'alice' ? 'bob' : 'alice', 'x-request-id': 'forged-id' },
          body: JSON.stringify({ documentId: 'voice-imported-id' }),
        }), action, action === 'create' ? undefined : `${owner}-voice`, {
          getUser: async () => ({ userId: owner }), serverUrl: 'https://voice.example', clientKey: key,
          authorizeDocument: (userId, id) => authorizeVoiceDocument(pg as SqlClient, userId, id),
          fetch: async (input, init) => {
            const headers = new Headers(init?.headers);
            expect(headers.get('authorization')).toBe(`Bearer ${key}`);
            calls.push({ user: headers.get('x-vdoc-user-id'), requestId: headers.get('x-request-id'), url: String(input) });
            if (action === 'end') return new Response(null, { status: 204 });
            const grant = { token: 'short-lived-grant', expiresAt: Date.now() + 60000 };
            return Response.json(action === 'grant' ? grant : { documentId: transport, sessionId: `${owner}-voice`, grant, realtimePath: `/v1/documents/${transport}/voice-sessions/${owner}-voice/realtime` }, { status: 201 });
          },
        });
        expect(result.status).toBe(action === 'end' ? 204 : 201);
        const body = await result.text();
        expect(body).not.toContain(key);
        expect(body).not.toContain('forged-id');
      }
    }
    expect(calls.map(call => call.user)).toEqual(['alice', 'alice', 'alice', 'bob', 'bob', 'bob']);
    expect(new Set(calls.map(call => call.requestId)).size).toBe(6);
    const rooms = calls.map(call => call.url.split('/')[5]);
    expect(new Set(rooms.slice(0, 3)).size).toBe(1);
    expect(new Set(rooms.slice(3)).size).toBe(1);
    expect(rooms[0]).not.toBe(rooms[3]);
    await pg.query('delete from library_item where id=$1', ['voice-imported-id']);
  });
  it('permanently removes document contents and versions while retaining a non-resurrectable tombstone', async () => {
    expect((await call('alice', { action: 'delete', id: 'same-id', expectedRevision: 4 })).status).toBe(409);
    const trash = await put('alice', { action: 'trash', id: 'same-id', expectedRevision: 4 });
    const deleted = await put('alice', { action: 'delete', id: 'same-id', expectedRevision: trash.revision });
    expect(deleted.deletedAt).not.toBeNull();
    expect(deleted.title).toBe('Deleted document');
    expect((await call('alice', undefined, 'same-id')).status).toBe(404);
    expect((await call('alice', doc('same-id'))).status).toBe(409);
    expect((await call('alice', { action: 'restore', id: 'same-id', expectedRevision: deleted.revision })).status).toBe(404);
    expect((await pg.query("select id from document_version where owner_id='alice' and document_id='same-id'")).rows).toHaveLength(0);
    expect((await call('bob', undefined, 'same-id')).status).toBe(200);
    const list = await (await call('alice')).json() as { items: CloudItem[] };
    expect(list.items.find(i => i.id === 'same-id')?.deletedAt).toBeTruthy();
    expect(list.items.every(i => !('content' in i))).toBe(true);
  });
  it('rolls back partial hierarchy changes on a failed transaction', async () => {
    const broken = deps('alice'); const real = broken.database;
    broken.database = (owner, write, work) => real(owner, write, async db => {
      await work(db); throw new Error('DB failure with postgres://secret@private');
    });
    const response = await handleLibraryRequest(new Request(`${origin}/api/library`, { method: 'POST', headers: { origin, 'content-type': 'application/json', 'x-vdoc-account': 'alice' }, body: JSON.stringify(doc('rollback')) }), broken);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('postgres:');
    expect((await call('alice', undefined, 'rollback')).status).toBe(404);
  });
  it('paginates metadata without document bodies or other owners', async () => {
    await pg.exec(`insert into library_item(owner_id,id,kind,title)
      select 'bob','page-' || lpad(n::text,3,'0'),'folder','Page folder' from generate_series(1,102) n`);
    const first = await (await call('bob')).json() as { items: CloudItem[]; nextCursor: string };
    expect(first.items).toHaveLength(100);
    expect(first.nextCursor).toBeTruthy();
    const response = await handleLibraryRequest(new Request(`${origin}/api/library?after=${first.nextCursor}`, { headers: { 'x-vdoc-account': 'bob' } }), deps('bob'));
    const second = await response.json() as { items: CloudItem[]; nextCursor: string | null };
    expect(second.nextCursor).toBeNull();
    const all = [...first.items, ...second.items];
    expect(new Set(all.map(i => i.id)).size).toBe(103);
    expect(all.some(i => i.id === 'alice-only')).toBe(false);
    expect(all.some(i => 'content' in i)).toBe(false);
  });
  it('bounds streamed uploads even without a Content-Length header', async () => {
    const response = await handleLibraryRequest(new Request(`${origin}/api/library`, {
      method: 'POST', headers: { origin, 'content-type': 'application/json', 'x-vdoc-account': 'alice' },
      body: 'x'.repeat(8 * 1024 * 1024 + 1),
    }), deps('alice'));
    expect(response.status).toBe(413);
  });
});
