import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Editor } from '@tiptap/core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createExtensions } from '../lib/editor/extensions';
import { fileFormats } from '../lib/composition/file-formats';
import { exportDocumentFile } from '../lib/composition/document-export';
import { readDocumentImport } from '../lib/composition/import-file';
import { createFormatRegistry, type FileFormat, type FormatRegistry } from '../lib/usecases/file-formats';
import { createFileExport } from '../lib/usecases/export-file';
import { createDocumentImport } from '../lib/usecases/import-file';
import { exportFilename } from '../lib/infrastructure/export/export-filename';
import { ExportMenuItems } from '../components/editor/export-menu-items';
import { DocumentImportInput } from '../components/editor/document-import-input';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '../components/ui/dropdown-menu';

vi.mock('mammoth', () => vi.importActual('mammoth/mammoth.browser.js'));
let editor: Editor, root: Root, mount: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  editor = new Editor({ extensions: createExtensions(), content: '<p>Round trip 中文 العربية 👩‍💻</p>' });
  await new Promise(resolve => setTimeout(resolve, 0));
  mount = document.createElement('div'); document.body.appendChild(mount); root = createRoot(mount);
});
afterEach(() => { act(() => root.unmount()); mount.remove(); editor.destroy(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const bytes = (blob: Blob) => new Promise<ArrayBuffer>((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(blob);
});
const source = () => ({ title: 'Round trip', doc: editor.state.doc, json: editor.getJSON(), html: editor.getHTML() });
async function openMenu(registry: FormatRegistry, onExport = vi.fn(), onPrint = vi.fn()) {
  await act(async () => root.render(createElement(DropdownMenu, null,
    createElement(DropdownMenuTrigger, null, 'Export'),
    createElement(DropdownMenuContent, null, createElement(ExportMenuItems, { registry, onExport, onPrint })))));
  await act(async () => mount.querySelector('button')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  return Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
}

it('registers all supported formats, capabilities and existing menu labels in one place', async () => {
  expect(fileFormats.formats.map(format => [format.id, format.extension, Boolean(format.import), Boolean(format.export)])).toEqual([
    ['json', 'vdoc.json', true, true], ['html', 'html', false, true], ['docx', 'docx', true, true],
    ['txt', 'txt', true, true], ['pdf', 'pdf', false, true],
  ]);
  const menu = await openMenu(fileFormats);
  expect(menu.map(item => item.textContent)).toEqual([
    'Download VDoc backup', 'Download HTML', 'Download Word (.docx)', 'Download plain text', 'Print / Save as PDF',
  ]);
});

it.each(fileFormats.exportable)('routes the $id menu entry to its declared preparation flow', async format => {
  const onExport = vi.fn(), onPrint = vi.fn();
  const items = await openMenu(fileFormats, onExport, onPrint);
  await act(async () => items.find(item => item.textContent === format.menuLabel)!.click());
  if (format.export!.kind === 'paginated') { expect(onPrint).toHaveBeenCalledOnce(); expect(onExport).not.toHaveBeenCalled(); }
  else { expect(onExport).toHaveBeenCalledExactlyOnceWith(format.id); expect(onPrint).not.toHaveBeenCalled(); }
});

it('uses only import-capable formats in the shared library/editor file picker', async () => {
  await act(async () => root.render(createElement(DocumentImportInput, { inputRef: { current: null }, disabled: false, label: 'Import', onFile: vi.fn() })));
  expect(mount.querySelector('input')!.accept).toBe(fileFormats.accept);
  expect(fileFormats.accept).toBe('.json,.docx,.txt');
  await expect(readDocumentImport({ name: 'Unsupported.html', size: 1 } as File)).rejects.toThrow('cannot be imported');
});

it.each(fileFormats.formats.filter(format => format.import && format.export?.kind === 'document'))('round-trips registered $id output through registry import dispatch', async format => {
  const before = source(), file = await exportDocumentFile(format.id, before), buffer = await bytes(file.blob);
  expect(file.name).toBe(`Round trip.${format.extension}`);
  const imported = await readDocumentImport({ name: file.name, size: buffer.byteLength, arrayBuffer: async () => buffer } as File);
  const restored = new Editor({ extensions: createExtensions(), content: imported.document.content });
  try {
    expect(restored.getText()).toBe(editor.getText());
    if (format.id === 'json') expect(restored.getJSON()).toEqual(before.json);
    expect(imported.document.title).toBe(before.title);
    expect(editor.getJSON()).toEqual(before.json);
  } finally { restored.destroy(); }
});

it('adds a format with one strategy module and one entry, without a menu or use-case edit', async () => {
  // A stand-in Markdown module, deliberately unknown to all production components.
  const markdown: FileFormat = {
    id: 'md', label: 'Markdown', extension: 'md', menuLabel: 'Download Markdown',
    export: { kind: 'document', delivery: 'download', strategy: { write: value => ({ blob: new Blob([value.doc.textContent], { type: 'text/markdown' }) }) } },
    import: { extensions: ['md'], strategy: { accepts: () => true, async read(file, title) {
      return { format: 'markdown', warnings: [], document: { version: 1, title, savedAt: '2026-10-14T00:00:00.000Z',
        content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: new TextDecoder().decode(await file.arrayBuffer()) }] }] } } };
    } } },
  };
  const registry = createFormatRegistry([...fileFormats.formats, markdown]);
  expect(registry.accept).toBe('.json,.docx,.txt,.md');
  const requested = vi.fn();
  const menu = await openMenu(registry, requested);
  await act(async () => menu.find(item => item.textContent === 'Download Markdown')!.click());
  expect(requested).toHaveBeenCalledExactlyOnceWith('md');
  const output = await createFileExport(registry, exportFilename).exportDocument(requested.mock.calls[0][0], source());
  const buffer = await bytes(output.blob);
  const input = { name: output.name, size: buffer.byteLength, arrayBuffer: async () => buffer } as File;
  const imported = await createDocumentImport(registry).readDocumentImport(input);
  expect(imported.format).toBe('markdown'); expect(imported.document.title).toBe('Round trip');
  expect(imported.document.content.content![0].content![0].text).toBe(editor.getText());
});

it('rejects ambiguous IDs and unsafe extensions at registry construction', () => {
  expect(() => createFormatRegistry([fileFormats.get('json'), fileFormats.get('json')])).toThrow('Duplicate');
  expect(() => createFormatRegistry([{ ...fileFormats.get('txt'), extension: '../txt' }])).toThrow('Invalid extension');
});
