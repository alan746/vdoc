import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { readFileSync } from 'node:fs';
import { beforeEach, expect, it, vi } from 'vitest';
import { getSchema, type JSONContent } from '@tiptap/core';
import { TableMap } from '@tiptap/pm/tables';
import { createExtensions } from '../lib/editor/extensions';
import { parseDocument } from '../lib/infrastructure/persistence/storage';

const schema = getSchema(createExtensions());
const cell = (text: string, attrs = {}): JSONContent => ({ type: 'tableCell', attrs, content: [{ type: 'paragraph', content: [{ type: 'text', text, marks: [{ type: 'bold' }] }] }] });
const row = (...content: JSONContent[]): JSONContent => ({ type: 'tableRow', content });
const table = (...content: JSONContent[]): JSONContent => ({ type: 'table', content });
const document = (content: JSONContent) => ({ version: 1 as const, title: 'Table backup', savedAt: '2026-10-05T12:00:00.000Z', content: { type: 'doc', content: [content] } });
const missing = () => table(row(cell('中文'), cell('العربية')), row(cell('日本語')));
const invalidTables = [
  ['missing', missing()],
  ['overlong_rowspan', table(row(cell('中文', { rowspan: 2 })))],
  ['collision', table(row(cell('A'), cell('B', { rowspan: 2 })), row(cell('C', { colspan: 2 })))],
  ['zero_sized', table(row())],
] as const;

beforeEach(() => { localStorage.clear(); globalThis.indexedDB = new IDBFactory(); vi.resetModules(); });
it.each(invalidTables)('rejects %s table geometry even when the node schema is valid', (problem, content) => {
  const node = schema.nodeFromJSON(content); expect(() => node.check()).not.toThrow();
  expect(TableMap.get(node).problems?.some(entry => entry.type === problem)).toBe(true);
  expect(() => parseDocument(JSON.stringify(document(content)))).toThrow('invalid table structure');
});
it('checks nested tables as well as the outer table', () => {
  const outer = table(row({ type: 'tableCell', content: [{ type: 'paragraph' }, missing()] }));
  expect(TableMap.get(schema.nodeFromJSON(outer)).problems).toBeNull();
  expect(() => parseDocument(JSON.stringify(document(outer)))).toThrow('invalid table structure');
});
it('preserves valid row/column merges, fully covered rows, nested cells and formatting', () => {
  const nested = table(row(cell('Nested עברית')));
  const merged = cell('中文 👩‍💻', { colspan: 2, rowspan: 2, colwidth: [120, 160], backgroundColor: '#FEF08A' });
  merged.content!.push(nested);
  const content = table(row(merged), row(), row(cell('العربية', { colwidth: [120] }), cell('日本語', { colwidth: [160] })));
  const normalized = schema.nodeFromJSON(document(content).content).toJSON();
  expect(parseDocument(JSON.stringify(document(content))).content).toEqual(normalized);
});
it('keeps legacy partial column widths readable without treating them as missing cells', () => {
  const content = table(row(cell('A', { colwidth: [120] }), cell('B')), row(cell('C'), cell('D')));
  expect(TableMap.get(schema.nodeFromJSON(content)).problems?.every(entry => entry.type === 'colwidth mismatch')).toBe(true);
  expect(parseDocument(JSON.stringify(document(content))).content).toEqual(schema.nodeFromJSON(document(content).content).toJSON());
});
it.each(['tests/fixtures/safari-preview/source.vdoc.json', 'tests/fixtures/local-download/mixed.vdoc.json'])('preserves the complete table content of the existing real-file fixture %s', path => {
  const raw = readFileSync(path, 'utf8'), source = JSON.parse(raw);
  expect(parseDocument(raw).content).toEqual(schema.nodeFromJSON(source.content).toJSON());
});
it('rejects a damaged saved version without changing the current document or pruning checkpoints', async () => {
  const store = await import('../lib/infrastructure/persistence/document-store');
  const original = await store.activateDocument({ ...parseDocument(JSON.stringify(document(table(row(cell('Current 中文')))))), id: 'keep-table' });
  const first = await store.saveVersion(original, 'First');
  for (let i = 1; i < 40; i++) await store.saveVersion(original, `Version ${i}`);
  const db = await store.openDatabase(), tx = db.transaction('versions', 'readwrite'), done = store.transactionDone(tx);
  tx.objectStore('versions').put({ ...first, document: { ...original, content: document(missing()).content } }); await done;
  const before = await store.listVersions(original.id);
  await expect(store.restoreVersion(first.key, original)).rejects.toThrow('invalid table structure');
  expect(await store.listVersions(original.id)).toEqual(before);
  expect((await store.readSavedDocument()).data).toEqual(original);
  expect((await store.listDocuments())[0].title).toBe(original.title);
});
it('keeps corrupt stored table data intact and leaves the active document unchanged on a failed link open', async () => {
  const store = await import('../lib/infrastructure/persistence/document-store');
  const original = await store.activateDocument({ ...parseDocument(JSON.stringify(document(table(row(cell('Current')))))), id: 'keep-current' });
  const corrupt = { ...document(missing()), id: 'corrupt-table' };
  await store.archiveDocument(corrupt);
  const opened = await store.readSavedDocument(corrupt.id);
  expect(opened.data).toBeNull(); expect(opened.error).toContain('invalid table structure');
  expect((await store.readSavedDocument()).data).toEqual(original);
  const db = await store.openDatabase();
  expect(await store.requestResult(db.transaction('documents').objectStore('documents').get(corrupt.id))).toEqual(corrupt);
});
