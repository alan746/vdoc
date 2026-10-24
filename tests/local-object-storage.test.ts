import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DocumentDraft } from '../lib/domain/entities/document';

beforeEach(() => { localStorage.clear(); globalThis.indexedDB = new IDBFactory(); vi.resetModules(); });
afterEach(() => vi.restoreAllMocks());

it('creates, opens, copies, renames and restores object documents without serializing their bodies to JSON strings', async () => {
  const store = await import('../lib/infrastructure/persistence/document-store');
  const library = await import('../lib/infrastructure/persistence/library-store');
  const versions = await import('../lib/infrastructure/persistence/version-store');
  const { parseDocument } = await import('../lib/infrastructure/persistence/document-codec');
  const source: DocumentDraft = { version: 1, title: 'Keep 中文 العربية', savedAt: '2026-10-23T00:00:00.000Z', content: {
    type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'café 👩‍💻', marks: [{ type: 'bold' }] }] },
      { type: 'image', attrs: { src: 'data:image/png;base64,AAAA', alt: 'Local image' } },
    ],
  } };
  const original = structuredClone(source), expectedContent = parseDocument(JSON.stringify(source)).content;
  const stringify = JSON.stringify;
  vi.spyOn(JSON, 'stringify').mockImplementation((value, replacer, space) => {
    if (value?.content?.type === 'doc') throw new Error('Unexpected document string conversion');
    return stringify(value, replacer, space);
  });
  const created = await library.createLibraryDocument(source, null);
  expect(source).toEqual(original); expect(created.content).toEqual(expectedContent);
  expect(await store.selectDocument(created.id)).toEqual(created);
  expect((await store.readSavedDocument()).data).toEqual(created);
  expect(await store.openArchivedDocument(created.id)).toEqual(created);
  const checkpoint = await versions.saveVersion(created, 'Before rename');
  const copy = await library.copyLibraryDocument(created.id);
  expect(copy.content).toEqual(expectedContent); expect(copy.id).not.toBe(created.id);
  await library.updateLibraryItem(created.id, { title: 'Renamed 中文' });
  const renamed = await store.openArchivedDocument(created.id);
  expect(renamed.title).toBe('Renamed 中文'); expect(renamed.content).toEqual(expectedContent);
  const restored = await versions.restoreVersion(checkpoint.key, renamed);
  expect(restored.title).toBe(created.title); expect(restored.content).toEqual(expectedContent);
  expect((await store.readSavedDocument()).data).toEqual(restored);
  expect((await versions.listVersions(created.id))[0].snapshot).toEqual({ title: renamed.title, content: expectedContent });
});
