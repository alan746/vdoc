import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { Editor, generateHTML, generateJSON, type JSONContent } from '@tiptap/core';
import { TableMap } from '@tiptap/pm/tables';
import { createExtensions } from '../lib/editor/extensions';
import { DocumentEngine } from '../lib/usecases/engine';
import { importWord, exportWord } from '../lib/infrastructure/word/word';
import { parseDocument } from '../lib/infrastructure/persistence/storage';
import { activateDocument, saveDocument, saveVersion, restoreVersion } from '../lib/infrastructure/persistence/document-store';
import JSZip from 'jszip';
vi.mock('mammoth', () => vi.importActual('mammoth/mammoth.browser.js'));
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6x8AAAAASUVORK5CYII=';
const bytes = (blob: Blob) => new Promise<ArrayBuffer>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(blob); });
const images = (node: JSONContent): JSONContent[] => [...(node.type === 'image' ? [node] : []), ...(node.content || []).flatMap(images)];
afterEach(() => vi.unstubAllGlobals());

it('preserves a non-native image ratio inside a vertically merged multilingual table through Word and version restoration', async () => {
  const d = await import('docx');
  const source = new d.Document({ sections: [{ children: [new d.Paragraph('Mixed 中文 العربية'), new d.Table({ rows: [
    new d.TableRow({ children: [new d.TableCell({ rowSpan: 2, children: [new d.Paragraph('Image cell 日本語'), new d.Paragraph({ children: [new d.ImageRun({ data: Uint8Array.from(atob(png), char => char.charCodeAt(0)), type: 'png', transformation: { width: 180, height: 90 }, altText: { name: 'Sample', title: 'Sample', description: '图片 العربية' } })] })] }), new d.TableCell({ children: [new d.Paragraph('Top 中文')] })] }),
    new d.TableRow({ children: [new d.TableCell({ children: [new d.Paragraph({ bidirectional: true, children: [new d.TextRun('أسفل')] })] })] }),
  ] })] }] });
  const imported = await importWord(await bytes(await d.Packer.toBlob(source)));
  const valid = parseDocument(JSON.stringify({ version: 1, title: 'Mixed image', content: imported.content })).content;
  expect(images(valid)[0].attrs).toMatchObject({ width: 180, height: 90, alt: '图片 العربية', src: `data:image/png;base64,${png}` });
  const table = valid.content!.find(node => node.type === 'table')!;
  const editor = new Editor({ extensions: createExtensions(), content: valid });
  try {
    const map = TableMap.get(editor.schema.nodeFromJSON(table)); expect(map.width).toBe(2); expect(map.height).toBe(2);
    expect(table.content![0].content![0].attrs!.rowspan).toBe(2);
    const doc = await activateDocument({ version: 1, id: crypto.randomUUID(), title: 'Mixed image', content: valid, savedAt: new Date().toISOString() });
    const checkpoint = await saveVersion(doc, 'Rich image baseline');
    const changed = await saveDocument('Later', { type: 'doc', content: [{ type: 'paragraph' }] }, doc.id);
    const restored = await restoreVersion(checkpoint.key, changed); expect(restored.content).toEqual(valid);
    // jsdom has no bitmap decoder: provide the real fixture's 1×1 dimensions.
    // DOCX media, XML, Mammoth import and IndexedDB transactions remain real.
    vi.stubGlobal('Image', class { naturalWidth = 1; naturalHeight = 1; onload: (() => void) | null = null; set src(_: string) { queueMicrotask(() => this.onload?.()); } });
    const exported = await bytes(await exportWord(restored.content, 'Mixed image'));
    const zip = await JSZip.loadAsync(exported);
    const xml = new DOMParser().parseFromString(await zip.file('word/document.xml')!.async('string'), 'application/xml');
    const extent = xml.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing', 'extent')[0];
    expect(extent.getAttribute('cx')).toBe(String(180 * 9525)); expect(extent.getAttribute('cy')).toBe(String(90 * 9525));
    const output = await importWord(exported); expect(images(output.content)[0].attrs).toMatchObject({ width: 180, height: 90, alt: '图片 العربية', src: `data:image/png;base64,${png}` });
    expect(JSON.stringify(output.content)).toContain('أسفل'); expect(JSON.stringify(output.content)).toContain('Top 中文');
    const outputTable = output.content.content!.find(node => node.type === 'table')!;
    expect(outputTable.content![0].content![0].attrs!.rowspan).toBe(2); expect(TableMap.get(editor.schema.nodeFromJSON(outputTable)).width).toBe(2);
  } finally { editor.destroy(); }
});

it('parses numeric image height from HTML and keeps dimensions in native backups', () => {
  const content = generateJSON(`<img src="data:image/png;base64,${png}" width="180" height="90" alt="Sample">`, createExtensions());
  expect(images(content)[0].attrs!.height).toBe(90);
  expect(images(parseDocument(JSON.stringify({ version: 1, title: 'Image', content })).content)[0].attrs).toMatchObject({ width: 180, height: 90 });
  const html = new DOMParser().parseFromString(generateHTML(content, createExtensions()), 'text/html');
  expect(html.querySelector('img')!.style.aspectRatio).toBe('180 / 90');
});

it('keeps the displayed ratio when changing image width and restores both dimensions on undo', () => {
  const editor = new Editor({ extensions: createExtensions(), content: { type: 'doc', content: [{ type: 'image', attrs: { src: `data:image/png;base64,${png}`, width: 180, height: 90 } }, { type: 'paragraph' }] } });
  const engine = new DocumentEngine(editor);
  try {
    editor.commands.setNodeSelection(0);
    expect(engine.execute({ operations: [{ type: 'image.update', width: 360 }] }).ok).toBe(true);
    expect(editor.state.doc.firstChild!.attrs).toMatchObject({ width: 360, height: 180 });
    expect(engine.history('undo').ok).toBe(true); expect(editor.state.doc.firstChild!.attrs).toMatchObject({ width: 180, height: 90 });
    expect(engine.history('redo').ok).toBe(true); expect(editor.state.doc.firstChild!.attrs).toMatchObject({ width: 360, height: 180 });
  } finally { engine.destroy(); editor.destroy(); }
});

it('rejects a width change whose scaled height would exceed the backup layout limit', () => {
  const editor = new Editor({ extensions: createExtensions(), content: { type: 'doc', content: [{ type: 'image', attrs: { src: `data:image/png;base64,${png}`, width: 40, height: 10000 } }, { type: 'paragraph' }] } });
  const engine = new DocumentEngine(editor);
  try {
    editor.commands.setNodeSelection(0); const before = editor.getJSON();
    expect(engine.execute({ operations: [{ type: 'image.update', width: 1200 }] }).ok).toBe(false);
    expect(editor.getJSON()).toEqual(before);
  } finally { engine.destroy(); editor.destroy(); }
});
