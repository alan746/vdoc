import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { parseDocument } from '../lib/infrastructure/persistence/storage';
import { exportHTML } from '../lib/infrastructure/export/html-export';
import { previewSource } from '../lib/infrastructure/preview/paged-preview';
import { previewPageWidth } from '../lib/infrastructure/preview/preview-layout';
import { exportWord, importWord } from '../lib/infrastructure/word/word';
// Exercise the browser build used by the app, which accepts ArrayBuffer input.
vi.mock('mammoth', () => vi.importActual('mammoth/mammoth.browser.js'));

beforeEach(() => { localStorage.clear(); globalThis.indexedDB = new IDBFactory(); vi.resetModules(); });
const backup = (attrs: Record<string, unknown> = {}) => ({ version: 1, id: 'layout-document', title: 'Layout 中文', savedAt: '2026-10-05T12:00:00.000Z', content: { type: 'doc', attrs, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Keep 中文 العربية' }] }] } });
it.each([
  { pageSize: 'a3' }, { orientation: 'upside-down' }, { orientation: null },
  { pageNumbers: 'false' }, { pageNumbers: 1 },
  { pageMargin: 0 }, { pageMargin: 200 }, { pageMargin: 12.5 },
])('rejects unsupported page settings rather than silently changing them: %j', attrs => {
  expect(() => parseDocument(JSON.stringify(backup(attrs)))).toThrow(/page|margin/i);
});
it('continues to apply documented defaults to older documents with omitted page settings', () => {
  expect(parseDocument(JSON.stringify(backup())).content.attrs).toMatchObject({ pageSize: 'a4', orientation: 'portrait', pageMargin: 20, pageNumbers: false });
});
const bytes = (blob: Blob) => new Promise<ArrayBuffer>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(blob); });
it.each([
  ['a4', 'portrait', 5, 210], ['a4', 'landscape', 50, 297],
  ['letter', 'portrait', 15, 215.9], ['letter', 'landscape', 35, 279.4],
] as const)('preserves %s %s with %d mm margins through backup, preview, HTML and Word', async (pageSize, orientation, pageMargin, width) => {
  const attrs = { pageSize, orientation, pageMargin, pageNumbers: true, header: 'Header 中文', footer: 'Footer العربية' };
  const doc = parseDocument(JSON.stringify(backup(attrs))), original = structuredClone(doc);
  expect(doc.content.attrs).toMatchObject(attrs);
  expect(previewPageWidth(doc.content)).toBeCloseTo((width - 2 * pageMargin) * 96 / 25.4);
  const html = exportHTML(doc.title, '<p>Keep 中文 العربية</p>', doc.content);
  const preview = previewSource(doc.title, '<p>Keep 中文 العربية</p>', doc.content);
  expect(html).toContain(`size:${pageSize === 'a4' ? 'A4' : 'letter'} ${orientation};margin:${pageMargin}mm`);
  expect(preview.css).toContain(`margin:${pageMargin}mm`);
  const output = await bytes(await exportWord(doc.content, doc.title)), zip = await JSZip.loadAsync(output);
  const xml = new DOMParser().parseFromString(await zip.file('word/document.xml')!.async('string'), 'application/xml');
  const margin = xml.getElementsByTagName('w:pgMar')[0];
  for (const edge of ['top', 'bottom', 'left', 'right']) expect(Math.abs(Number(margin.getAttribute(`w:${edge}`)) - pageMargin * 56.693)).toBeLessThan(1);
  const imported = await importWord(output);
  expect(imported.content.attrs).toMatchObject(attrs); expect(doc).toEqual(original);
});
it('rejects opening a stored document with invalid page settings and keeps its raw data and previous selection', async () => {
  const store = await import('../lib/infrastructure/persistence/document-store'), idb = await import('../lib/infrastructure/persistence/indexed-db');
  const current = await store.activateDocument({ ...parseDocument(JSON.stringify(backup())), id: 'healthy-layout' });
  const damaged = { ...current, id: 'bad-layout', content: backup({ pageSize: 'a3' }).content };
  await store.archiveDocument(damaged);
  expect((await store.readSavedDocument(damaged.id)).error).toBeTruthy();
  expect((await store.readSavedDocument()).data).toEqual(current);
  const db = await idb.openDatabase();
  expect(await idb.requestResult(db.transaction('documents').objectStore('documents').get(damaged.id))).toEqual(damaged);
});
it('rejects restoring a version with invalid margins without changing current work or checkpoint history', async () => {
  const store = await import('../lib/infrastructure/persistence/document-store'), versionStore = await import('../lib/infrastructure/persistence/version-store'), idb = await import('../lib/infrastructure/persistence/indexed-db');
  const current = await store.activateDocument(parseDocument(JSON.stringify(backup())));
  const version = await versionStore.saveVersion(current, 'Before edits');
  const db = await idb.openDatabase(), tx = db.transaction('versions', 'readwrite'), done = idb.transactionDone(tx);
  tx.objectStore('versions').put({ ...version, document: { ...current, content: backup({ pageMargin: 200 }).content } }); await done;
  const history = await versionStore.listVersions(current.id);
  await expect(versionStore.restoreVersion(version.key, current)).rejects.toThrow(/margin/i);
  expect(await versionStore.listVersions(current.id)).toEqual(history); expect((await store.readSavedDocument()).data).toEqual(current);
});
