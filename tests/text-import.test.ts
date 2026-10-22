import { expect, it } from 'vitest';
import { readDocumentImport } from '../lib/editor/import-file';
import { languageSamples, unicodeSamples } from './multilingual-fixtures';
import { Editor } from '@tiptap/core';
import { createExtensions } from '../lib/editor/extensions';
import { exportPlainText } from '../lib/editor/plain-text';

type Encoding = 'utf8' | 'utf8-bom' | 'utf16le' | 'utf16be';
function bytes(text: string, encoding: Encoding): Uint8Array<ArrayBuffer> {
  if (encoding.startsWith('utf8')) return new TextEncoder().encode((encoding === 'utf8-bom' ? '\uFEFF' : '') + text);
  const value = new Uint8Array(2 + text.length * 2), view = new DataView(value.buffer), little = encoding === 'utf16le';
  view.setUint16(0, 0xfeff, little);
  for (let i = 0; i < text.length; i++) view.setUint16(2 + i * 2, text.charCodeAt(i), little);
  return value;
}
// Use actual file bytes. jsdom only needs the standard Blob.arrayBuffer shim.
function upload(data: Uint8Array<ArrayBuffer>) {
  const file = new File([data], 'Multilingual notes.TXT', { type: 'text/plain' });
  Object.defineProperty(file, 'arrayBuffer', { value: () => new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = () => reject(reader.error); reader.readAsArrayBuffer(file);
  }) });
  return file;
}
const paragraphs = (result: Awaited<ReturnType<typeof readDocumentImport>>) => result.document.content.content!.map(node => node.content?.map(text => text.text || '').join('') || '');
it.each(['utf8', 'utf8-bom', 'utf16le', 'utf16be'] as const)('preserves all 40 language and 9 Unicode samples from actual %s file bytes', async encoding => {
  const lines = [...languageSamples.map(([, text]) => text), ...unicodeSamples, 'Literal replacement symbol: �', 'Middle\uFEFFmark'];
  const result = await readDocumentImport(upload(bytes(lines.join('\r\n'), encoding)));
  expect(paragraphs(result)).toEqual(lines); expect(result.format).toBe('text'); expect(result.warnings).toEqual([]);
  expect(result.document.title).toBe('Multilingual notes');
});
it.each(['utf8', 'utf16le', 'utf16be'] as const)('retains tabs, leading/trailing spaces, blank lines and a final newline in %s', async encoding => {
  const result = await readDocumentImport(upload(bytes('  中文\tالعربية  \r\n\r日本語\n', encoding)));
  expect(paragraphs(result)).toEqual(['  中文\tالعربية  ', '', '日本語', '']);
});
it.each(['utf8', 'utf8-bom', 'utf16le', 'utf16be'] as const)('imports an empty %s file as an editable blank paragraph', async encoding => {
  expect(paragraphs(await readDocumentImport(upload(bytes('', encoding))))).toEqual(['']);
});
it.each([
  ['truncated UTF-8', [0xe4, 0xb8]],
  ['legacy code-page bytes', [0xd6, 0xd0, 0xce, 0xc4]],
  ['truncated UTF-16 LE', [0xff, 0xfe, 0x2d]],
  ['unpaired UTF-16 surrogate', [0xfe, 0xff, 0xd8, 0x00]],
  ['unmarked UTF-16', [0x41, 0, 0x42, 0]],
  ['UTF-32 LE', [0xff, 0xfe, 0, 0, 0x41, 0, 0, 0]],
  ['UTF-32 BE', [0, 0, 0xfe, 0xff, 0, 0, 0, 0x41]],
] as const)('rejects %s instead of silently returning damaged text', async (_name, values) => {
  await expect(readDocumentImport(upload(new Uint8Array(values)))).rejects.toThrow('Save it as UTF-8');
});
it('preserves readable export text when reimported, including tables, lists and multilingual notes', async () => {
  const editor = new Editor({ extensions: createExtensions(), content: '<ol start="3"><li><p>中文 👩‍💻</p></li></ol><table><tr><td><p>العربية</p></td><td><p>日本語</p></td></tr></table><p>café</p>' });
  try {
    const text = exportPlainText(editor.state.doc);
    const result = await readDocumentImport(upload(bytes(text, 'utf8')));
    expect(paragraphs(result).join('\n')).toBe(text);
  } finally { editor.destroy(); }
});
