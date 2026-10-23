import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentDraft, SavedDocument, VersionSnapshot } from '../lib/domain/entities/document';
import type { DocumentRepository, LibraryRepository, VersionRepository } from '../lib/usecases/ports';
import { createInMemoryRepositories } from './support/in-memory-repositories';

type Repositories = { documents: DocumentRepository; library: LibraryRepository; versions: VersionRepository };
const implementations: [string, () => Promise<Repositories>][] = [
  ['IndexedDB', async () => {
    localStorage.clear(); globalThis.indexedDB = new IDBFactory(); vi.resetModules();
    const { indexedDbDocuments, indexedDbLibrary, indexedDbVersions } = await import('../lib/infrastructure/persistence/repositories');
    return { documents: indexedDbDocuments, library: indexedDbLibrary, versions: indexedDbVersions };
  }],
  ['in-memory', async () => createInMemoryRepositories()],
];
const doc = (text: string, title = 'Doc 中文'): DocumentDraft => ({ version: 1, title, savedAt: '2026-10-14T00:00:00.000Z', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } });
const text = (document: SavedDocument | VersionSnapshot | null) => JSON.stringify(document?.content).match(/"text":"([^"]*)"/)?.[1];

// One behavioural contract for every persistence implementation: a new backend
// is ready to wire into lib/composition when it passes this suite.
describe.each(implementations)('persistence contract: %s', (_name, create) => {
  let repo: Repositories;
  beforeEach(async () => { repo = await create(); });

  it('activates, reads, selects and saves documents', async () => {
    const stored = await repo.documents.activate(doc('first'));
    expect(stored.id).toBeTruthy();
    expect(text((await repo.documents.readActive()).data)).toBe('first');
    const saved = await repo.documents.save('Renamed', { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'second' }] }] }, stored.id);
    expect(saved).toMatchObject({ id: stored.id, title: 'Renamed' });
    expect(text((await repo.documents.select(stored.id)))).toBe('second');
    expect(text((await repo.documents.readActive(stored.id)).data)).toBe('second');
    await expect(repo.documents.save('x', doc('x').content, 'missing-id')).rejects.toThrow();
  });

  it('organises folders, documents and stars and rejects cyclic moves', async () => {
    const root = await repo.library.createFolder('Root', null), child = await repo.library.createFolder('Child', root);
    const created = await repo.library.createDocument(doc('in folder'), child);
    await repo.library.update(created.id, { starred: true });
    const items = await repo.library.list();
    expect(items.find(item => item.id === child)).toMatchObject({ kind: 'folder', parentId: root });
    expect(items.find(item => item.id === created.id)).toMatchObject({ kind: 'document', parentId: child, starred: true });
    await expect(repo.library.update(root, { parentId: child })).rejects.toThrow('cannot be moved into itself');
  });

  it('trashes a folder subtree, blocks writes to trashed documents and restores the subtree', async () => {
    const root = await repo.library.createFolder('Root', null);
    const created = await repo.library.createDocument(doc('body'), root);
    await repo.library.update(root, { trash: true });
    const trashed = await repo.library.list();
    const group = trashed.find(item => item.id === root)!.trash?.group;
    expect(group).toBeTruthy();
    expect(trashed.find(item => item.id === created.id)?.trash?.group).toBe(group);
    await expect(repo.documents.save('x', doc('x').content, created.id)).rejects.toThrow('Trash');
    await expect(repo.documents.select(created.id)).rejects.toThrow('Trash');
    await repo.library.update(root, { trash: false });
    expect((await repo.library.list()).every(item => !item.trash)).toBe(true);
  });

  it('copies documents and only deletes trashed ones matching the expected trash state', async () => {
    const created = await repo.library.createDocument(doc('original', 'Plan'), null);
    const copy = await repo.library.copy(created.id);
    expect(copy).toMatchObject({ title: 'Copy of Plan' });
    expect(copy.id).not.toBe(created.id);
    await repo.versions.save(created, 'checkpoint');
    const trash = (await repo.library.update(created.id, { trash: true })).trash!;
    await expect(repo.library.deleteTrashed(created.id, { ...trash, at: '2000-01-01T00:00:00.000Z' })).rejects.toThrow('changed since');
    await repo.library.deleteTrashed(created.id, trash);
    expect((await repo.library.list()).map(item => item.id)).toEqual([copy.id]);
    expect(await repo.versions.list(created.id)).toEqual([]);
  });

  it('lists versions newest first and restores one while keeping a backup of the current draft', async () => {
    const created = await repo.library.createDocument(doc('v1'), null);
    await repo.versions.save(created, 'First');
    const current = await repo.documents.save(created.title, doc('v2').content, created.id);
    await repo.versions.save(current, 'Second');
    const listed = await repo.versions.list(created.id);
    expect(listed.map(version => version.label)).toEqual(['Second', 'First']);
    const restored = await repo.versions.restore(listed[1].key, current);
    expect(text(restored)).toBe('v1');
    expect(text((await repo.documents.readActive()).data)).toBe('v1');
    const after = await repo.versions.list(created.id);
    expect(after.map(version => version.label)).toContain('Before restoring a version');
    expect(text(after.find(version => version.label === 'Before restoring a version')!.snapshot)).toBe('v2');
  });
});
