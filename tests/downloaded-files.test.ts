import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it, vi } from 'vitest';
import { getSchema, type JSONContent } from '@tiptap/core';
import { readDocumentImport } from '../lib/editor/import-file';
import { createExtensions } from '../lib/editor/extensions';
import { exportPlainText } from '../lib/editor/plain-text';
vi.mock('mammoth', () => vi.importActual('mammoth/mammoth.browser.js'));

// Immutable bytes downloaded through the real UI; no conversion is used to build
// these fixtures during the test. FileReader supplies File.text/arrayBuffer in jsdom.
const path = (extension: string) => resolve('tests/fixtures/local-download', `mixed.${extension}`);
const source = JSON.parse(readFileSync(path('vdoc.json'), 'utf8'));
const read = (extension: string) => {
  const file = new File([Uint8Array.from(readFileSync(path(extension)))], `Mixed.${extension}`);
  const readFile = (asText: boolean) => new Promise<string | ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result as string | ArrayBuffer); reader.onerror = reject;
    if (asText) reader.readAsText(file); else reader.readAsArrayBuffer(file);
  });
  Object.defineProperties(file, { text: { value: () => readFile(true) }, arrayBuffer: { value: () => readFile(false) } });
  return readDocumentImport(file);
};
function nodes(node: JSONContent): JSONContent[] { return [node, ...(node.content || []).flatMap(nodes)]; }
const allText = (node: JSONContent) => nodes(node).filter(n => n.type === 'text').map(n => n.text);

it('imports the actual downloaded backup with exact structure, metadata and no existing identity', async () => {
  const result = await read('vdoc.json');
  expect(result.format).toBe('backup'); expect(result.warnings).toEqual([]);
  // Round-49 bytes predate paragraph shading; schema hydration adds only its neutral default.
  const expected = structuredClone(source);
  for (const node of nodes(expected.content)) if (['paragraph', 'heading'].includes(node.type || '')) node.attrs = {...node.attrs, paragraphBackground:null, paragraphBorders:null, paragraphBorderJoin:false};
  expect(result.document).toEqual(expected); expect(result.document.id).toBeUndefined();
});

it('imports the actual downloaded Word bytes with multilingual text, merged cells and image dimensions', async () => {
  const result = await read('docx'), content = result.document.content, items = nodes(content);
  expect(result.format).toBe('word'); expect(allText(content)).toEqual(allText(source.content));
  const table = items.find(n => n.type === 'table')!;
  expect(table.content).toHaveLength(2); expect(table.content![0].content).toHaveLength(2); expect(table.content![1].content).toHaveLength(1);
  expect(table.content![0].content![0].attrs).toMatchObject({ rowspan: 2, colspan: 1 });
  expect(items.find(n => n.type === 'image')?.attrs).toMatchObject({ src: nodes(source.content).find(n => n.type === 'image')!.attrs!.src, alt: '图片 العربية', width: 300, height: 150 });
  expect(items.find(n => n.type === 'heading')?.attrs?.level).toBe(2);
  expect(items.find(n => n.type === 'paragraph' && allText(n).join('') === 'أسفل')?.attrs?.direction).toBe('rtl');
});

it('opens the downloaded HTML structure with embedded image, explicit ratio and merged cells', () => {
  const doc = new DOMParser().parseFromString(readFileSync(path('html'), 'utf8'), 'text/html');
  expect(doc.title).toBe(source.title); expect(doc.querySelector('meta[charset]')?.getAttribute('charset')).toBe('UTF-8');
  const img = doc.querySelector('img')!;
  expect([img.width, img.height, img.alt, img.style.aspectRatio]).toEqual([300, 150, '图片 العربية', '300 / 150']);
  expect(img.src).toBe(nodes(source.content).find(n => n.type === 'image')!.attrs!.src);
  expect(doc.querySelector('td[rowspan="2"]')).not.toBeNull();
  for (const value of allText(source.content)) expect(doc.body.textContent).toContain(value);
});

it('imports the downloaded UTF-8 text without corrupting characters or line order', async () => {
  const result = await read('txt');
  expect(result.format).toBe('text');
  const paragraphs = result.document.content.content!;
  expect(paragraphs.map(n => allText(n).join('')).join('\n')).toBe(readFileSync(path('txt'), 'utf8'));
  expect(allText(result.document.content)).toEqual(allText(source.content));
});

it('matches the round-50 real TXT download and reimports its readable text without inventing tables', async () => {
  const raw = readFileSync(path('readable.txt'), 'utf8');
  expect(exportPlainText(getSchema(createExtensions()).nodeFromJSON(source.content))).toBe(raw);
  const result = await read('readable.txt');
  expect(result.document.content.content!.every(node => node.type === 'paragraph')).toBe(true);
  expect(result.document.content.content!.map(node => allText(node).join('')).join('\n')).toBe(raw);
  expect(raw).toContain('[Image: 图片 العربية]'); expect(raw).toContain('\tأسفل');
});
