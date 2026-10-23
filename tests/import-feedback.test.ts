import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import * as docx from 'docx';
import { readDocumentImport } from '../lib/composition/import-file';
import type { DocumentImport } from '../lib/usecases/ports';
import { exportWord } from '../lib/infrastructure/word/word';
import { notifyDocumentImport } from '../components/editor/import-feedback';

vi.mock('mammoth', () => vi.importActual('mammoth/mammoth.browser.js'));
const info = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: { info } }));
beforeEach(() => info.mockReset());
const bytes = (blob: Blob) => new Promise<ArrayBuffer>((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(blob);
});
const wordFile = (buffer: ArrayBuffer) => ({ name: 'Review 中文.DOCX', size: buffer.byteLength, arrayBuffer: async () => buffer }) as File;

it('carries actual custom tab conversion notices through file validation into visible feedback', async () => {
  const paragraph = () => new docx.Paragraph({ children: [new docx.TextRun({ children: ['中文', new docx.Tab(), 'العربية'] })], tabStops: [{ type: docx.TabStopType.CENTER, position: 2000 }] });
  const buffer = await bytes(await docx.Packer.toBlob(new docx.Document({ sections: [{ children: [paragraph(), paragraph()] }] })));
  const result = await readDocumentImport(wordFile(buffer));
  expect(result.document.title).toBe('Review 中文');
  expect(result.document.content.content![0].content![0].text).toBe('中文\tالعربية');
  expect(result.warnings.filter(message => message.includes('custom Word tab stops'))).toHaveLength(1);
  expect(result.document).not.toHaveProperty('warnings');
  notifyDocumentImport(result);
  const options = info.mock.calls[0][1];
  expect(options.duration).toBe(Infinity); expect(options.closeButton).toBe(true);
  expect(renderToStaticMarkup(options.description)).toContain('custom Word tab stops');
});

it('exposes the real checklist round-trip limitation instead of silently losing interactivity', async () => {
  const buffer = await bytes(await exportWord({ type: 'doc', content: [{ type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '完成 العربية' }] }] }] }] }, 'Checklist'));
  const result = await readDocumentImport(wordFile(buffer));
  expect(result.warnings).toContainEqual(expect.stringContaining('static checklist symbols'));
  notifyDocumentImport(result);
  const html = renderToStaticMarkup(info.mock.calls[0][1].description);
  expect(html).toContain('Interactive checkboxes'); expect(html).toContain('VDoc backup');
});

it('renders converter messages as text, retaining every detail without interpreting markup', () => {
  const warnings = ['<img src=x onerror=alert(1)>', '第二条 العربية'];
  notifyDocumentImport({ format: 'word', warnings } as DocumentImport);
  const html = renderToStaticMarkup(info.mock.calls[0][1].description);
  expect(html).not.toContain('<img'); expect(html).toContain('&lt;img'); expect(html).toContain('第二条 العربية');
});

it('keeps a general formatting reminder when conversion reports no known problems', () => {
  notifyDocumentImport({ format: 'word', warnings: [] } as unknown as DocumentImport);
  expect(info.mock.calls[0][0]).toBe('Word imported'); expect(info.mock.calls[0][1].duration).toBe(8000);
  expect(renderToStaticMarkup(info.mock.calls[0][1].description)).toContain('complex Word features may differ');
});

it.each(['text', 'backup'] as const)('does not attach Word warnings to %s imports', async format => {
  const text = format === 'text' ? '中文\nالعربية' : JSON.stringify({ version: 1, title: 'Backup', content: { type: 'doc', content: [{ type: 'paragraph' }] } });
  const result = await readDocumentImport({ name: format === 'text' ? 'Notes.txt' : 'Backup.json', size: text.length, text: async () => text, arrayBuffer: async () => new TextEncoder().encode(text).buffer } as File);
  expect(result.format).toBe(format); expect(result.warnings).toEqual([]);
  notifyDocumentImport(result); expect(info).not.toHaveBeenCalled();
});
