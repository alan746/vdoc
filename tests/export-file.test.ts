import { Editor } from '@tiptap/core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createExtensions } from '../lib/editor/extensions';
import { CURRENT_DOCUMENT_VERSION } from '../lib/domain/rules/document-migrations';
import { exportDocumentFile, exportPaginatedFile } from '../lib/composition/document-export';
import { fileFormats } from '../lib/composition/file-formats';
import { createFormatRegistry } from '../lib/usecases/file-formats';
import { createFileExport } from '../lib/usecases/export-file';
import { exportFilename } from '../lib/infrastructure/export/export-filename';
import { exportHTML } from '../lib/infrastructure/export/html-export';
import { exportPlainText } from '../lib/infrastructure/export/plain-text';
import * as word from '../lib/infrastructure/word/word';
import * as pdf from '../lib/infrastructure/pdf/local-pdf';

let editor: Editor;
beforeEach(async () => {
  editor = new Editor({ extensions: createExtensions(), content: '<h2>Bytes 中文</h2><p><strong>العربية 👩‍💻</strong></p><ol start="7"><li><p>Seven</p></li></ol>' });
  await new Promise(resolve => setTimeout(resolve, 0));
});
afterEach(() => { editor.destroy(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const source = () => ({ title: 'Exact bytes', doc: editor.state.doc, json: editor.getJSON(), html: editor.getHTML() });
const bytes = (blob: Blob) => new Promise<Uint8Array>((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer)); reader.onerror = reject; reader.readAsArrayBuffer(blob);
});

it.each(['html', 'txt', 'json'])('preserves the previous %s export byte for byte', async id => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-14T12:00:00.000Z'));
  const input = source();
  const expected = id === 'html' ? exportHTML(input.title, input.html, input.json)
    : id === 'txt' ? exportPlainText(input.doc)
      : JSON.stringify({ version: CURRENT_DOCUMENT_VERSION, title: input.title, content: input.json, savedAt: new Date().toISOString() }, null, 2);
  const result = await exportDocumentFile(id, input);
  expect(Array.from(await bytes(result.blob))).toEqual(Array.from(new TextEncoder().encode(expected)));
  expect(editor.getJSON()).toEqual(input.json);
});

it('delivers the exact Blob returned by the existing real Word converter', async () => {
  const convert = vi.spyOn(word, 'exportWord');
  const input = source(), result = await exportDocumentFile('docx', input);
  expect(convert).toHaveBeenCalledExactlyOnceWith(input.json, input.title);
  expect(result.blob).toBe(await convert.mock.results[0].value);
  expect((await bytes(result.blob)).slice(0, 2)).toEqual(new Uint8Array([80, 75]));
});

it('forwards the PDF service Blob unchanged, refreshing credentials and passing cancellation', async () => {
  const blob = new Blob(['%PDF-unchanged'], { type: 'application/pdf' });
  const token = vi.spyOn(pdf, 'requestLocalPdfToken').mockResolvedValue('fresh-token');
  const convert = vi.spyOn(pdf, 'requestLocalPdf').mockResolvedValue(blob);
  const input = { title: 'Sheets', html: '<div>Finished pages</div>', css: '@page {}', pages: 3, pageSize: 'a4' as const, orientation: 'portrait' as const };
  const signal = new AbortController().signal;
  const result = await exportPaginatedFile('pdf', input, { signal });
  expect(token).toHaveBeenCalledExactlyOnceWith(signal);
  expect(convert).toHaveBeenCalledExactlyOnceWith(input, 'fresh-token', signal);
  expect(result.blob).toBe(blob); expect(result.name).toBe('Sheets.pdf');
});

it('rejects unsupported input capabilities before conversion', () => {
  expect(() => exportDocumentFile('pdf', source())).toThrow('editor snapshot');
  expect(() => exportDocumentFile('missing', source())).toThrow('Unsupported');
});

it('supports an asynchronous added exporter and propagates failure without a partial file', async () => {
  const blob = new Blob(['new format']);
  const write = vi.fn().mockResolvedValue(blob).mockRejectedValueOnce(new Error('Conversion failed'));
  const registry = createFormatRegistry([...fileFormats.formats, {
    id: 'custom', label: 'Custom', extension: 'custom', menuLabel: 'Download Custom',
    export: { kind: 'document', delivery: 'prepared', strategy: { write: async () => ({ blob: await write() }) } },
  }]);
  const files = createFileExport(registry, exportFilename);
  await expect(files.exportDocument('custom', source())).rejects.toThrow('Conversion failed');
  await expect(files.exportDocument('custom', source())).resolves.toMatchObject({ name: 'Exact bytes.custom', blob });
});

it('does not invoke an exporter for an already-cancelled job', () => {
  const write = vi.spyOn(fileFormats.get('txt').export!.strategy, 'write');
  const abort = new AbortController(); abort.abort();
  expect(() => exportDocumentFile('txt', source(), { signal: abort.signal })).toThrow();
  expect(write).not.toHaveBeenCalled();
});

it('uses the migration policy version for registry backups when the current version advances', async () => {
  vi.resetModules();
  vi.doMock('../lib/domain/rules/document-migrations', async original => ({
    ...await original<typeof import('../lib/domain/rules/document-migrations')>(), CURRENT_DOCUMENT_VERSION: 2,
  }));
  try {
    const { exportDocumentFile: exportCurrent } = await import('../lib/composition/document-export');
    const result = await exportCurrent('json', source());
    const backup = JSON.parse(new TextDecoder().decode(await bytes(result.blob)));
    expect(backup.version).toBe(2);
    expect(backup.content).toEqual(editor.getJSON());
  } finally {
    vi.doUnmock('../lib/domain/rules/document-migrations');
    vi.resetModules();
  }
});
