import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Editor, type JSONContent } from '@tiptap/core';
import { DOMSerializer } from '@tiptap/pm/model';
import JSZip from 'jszip';
import { createExtensions } from '../lib/editor/extensions';
import { usePreparedExport, PreparedExportFeedback } from '../components/editor/prepared-export';

const calls = vi.hoisted(() => ({ convert: vi.fn(), error: vi.fn(), success: vi.fn() }));
vi.mock('../lib/infrastructure/word/word', () => ({ exportWord: calls.convert }));
vi.mock('mammoth', () => vi.importActual('mammoth/mammoth.browser.js'));
vi.mock('sonner', () => ({ toast: { error: calls.error, success: calls.success } }));
let editor: Editor, mount: HTMLDivElement, root: Root, state: ReturnType<typeof usePreparedExport>;
let jobs: { resolve: (blob: Blob) => void; reject: (error: Error) => void }[];
let createUrl: ReturnType<typeof vi.fn>, revokeUrl: ReturnType<typeof vi.fn>;
const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
function Harness({ title }: { title: string }) { const current = usePreparedExport(editor, title); useLayoutEffect(() => { state = current; }); return createElement(PreparedExportFeedback, { state: current }); }
async function render(title = 'Current draft') { await act(async () => root.render(createElement(Harness, { title }))); }
async function start() { await act(async () => { void state.request('docx'); }); }
async function finish(index = 0) { await act(async () => { jobs[index].resolve(new Blob(['Word data'])); }); }
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); calls.error.mockReset(); calls.success.mockReset(); jobs = [];
  calls.convert.mockReset().mockImplementation(() => new Promise<Blob>((resolve, reject) => jobs.push({ resolve, reject })));
  createUrl = vi.fn().mockImplementation(() => `blob:export-${createUrl.mock.calls.length}`); revokeUrl = vi.fn();
  URL.createObjectURL = createUrl; URL.revokeObjectURL = revokeUrl;
  editor = new Editor({ extensions: createExtensions(), content: '<p>Original 中文 العربية</p>' }); await new Promise(resolve => setTimeout(resolve, 0));
  mount = document.createElement('div'); document.body.appendChild(mount); root = createRoot(mount); await render();
});
afterEach(() => { act(() => root.unmount()); editor.destroy(); mount.remove(); URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('bounds the Word filename but passes the complete title and body to conversion', async () => {
  const title = '中文👩‍💻café'.repeat(25), before = editor.getJSON();
  await render(title); await start(); await finish();
  expect(new TextEncoder().encode(state.download!.name).length).toBeLessThanOrEqual(240);
  expect(state.download!.name.endsWith('.docx')).toBe(true);
  expect(calls.convert).toHaveBeenCalledWith(before, title);
  expect(editor.getJSON()).toEqual(before);
});
it('prepares Word without serializing unused HTML', async () => {
  const html = vi.spyOn(DOMSerializer.prototype, 'serializeFragment').mockImplementation(() => { throw new Error('Unneeded HTML'); });
  await start(); await finish();
  expect(state.download).not.toBeNull();
  expect(html).not.toHaveBeenCalled();
});

it('starts only one conversion on same-event repeated requests and displays progress', async () => {
  await act(async () => { void state.request('docx'); void state.request('docx'); });
  expect(calls.convert).toHaveBeenCalledOnce(); expect(state.busy).toBe(true); expect(mount.textContent).toContain('Preparing Word'); expect(editor.isEditable).toBe(true);
  await finish(); expect(state.busy).toBe(false); expect(document.querySelector('[aria-label="Word export"]')!.textContent).toContain('Word document ready');
});
it('exports a consistent snapshot and flags edits or renaming made while preparing', async () => {
  const before = editor.getJSON(); await start(); editor.commands.insertContent('Later edit '); await render('Renamed draft'); await finish();
  expect(calls.convert).toHaveBeenCalledWith(before, 'Current draft');
  expect(state.download).toMatchObject({ name: 'Current draft.docx', changedSinceStart: true });
  expect(document.querySelector('[aria-label="Word export"]')!.textContent).toContain('Your later edits are still in the document');
  expect(editor.getText()).toContain('Later edit');
});
it('does not flag selection-only changes as content edits', async () => {
  await start(); editor.commands.setTextSelection(3); await finish(); expect(state.download!.changedSinceStart).toBe(false);
});
it('discards late export results after leaving without allocating a blob URL', async () => {
  await start(); act(() => root.unmount()); await finish(); expect(createUrl).not.toHaveBeenCalled();
});
it('does not display a late failure after leaving', async () => {
  await start(); act(() => root.unmount()); await act(async () => { jobs[0].reject(new Error('Late error')); }); expect(calls.error).not.toHaveBeenCalled();
});
it('releases progress after failure and permits retry', async () => {
  await start(); await act(async () => { jobs[0].reject(new Error('Image cannot be decoded')); });
  expect(calls.error).toHaveBeenCalledWith('Image cannot be decoded'); expect(state.busy).toBe(false); expect(createUrl).not.toHaveBeenCalled();
  await start(); await finish(1); expect(state.download).not.toBeNull();
});
it('regenerates from the latest edits and releases replaced and closed URLs exactly once', async () => {
  await start(); editor.commands.insertContent('Latest '); await render('Latest: draft'); await finish(); const first = state.download!.url;
  const regenerate = Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Regenerate with latest edits')!;
  await act(async () => { regenerate.click(); }); expect(revokeUrl).toHaveBeenCalledWith(first); expect(state.download).toBeNull();
  expect(calls.convert.mock.calls[1]).toEqual([editor.getJSON(), 'Latest: draft']); await finish(1);
  expect(state.download).toMatchObject({ name: 'Latest_ draft.docx', changedSinceStart: false }); const second = state.download!.url;
  act(() => state.close()); expect(revokeUrl.mock.calls).toEqual([[first], [second]]);
  act(() => root.unmount()); expect(revokeUrl).toHaveBeenCalledTimes(2);
});
it('releases a completed download URL on unmount', async () => {
  await start(); await finish(); const url = state.download!.url; act(() => root.unmount()); expect(revokeUrl).toHaveBeenCalledExactlyOnceWith(url);
});
it('keeps the checklist warning tied to the exported snapshot', async () => {
  editor.commands.setContent('<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Checklist</p></li></ul>');
  await start(); editor.commands.setContent('<p>Later body</p>'); await finish();
  expect(state.download!.notices.some(notice => notice.code === 'static-checklist')).toBe(true); expect(document.querySelector('[aria-label="Word export"]')!.textContent).toContain('static checkbox symbols');
});

it('ignores the old editor result without clearing the new editor export state', async () => {
  await start(); const old = editor;
  editor = new Editor({ extensions: createExtensions(), content: '<p>New document</p>' });
  await render('New document'); await start(); await finish(0);
  expect(createUrl).not.toHaveBeenCalled(); expect(state.busy).toBe(true);
  await finish(1); expect(state.download!.name).toBe('New document.docx'); old.destroy();
});

it('does not steal focus from ongoing typing when Word preparation finishes', async () => {
  const typing = document.createElement('input'); document.body.appendChild(typing);
  try {
    await start(); typing.focus(); typing.value = 'Still typing 中文'; await finish();
    expect(document.activeElement).toBe(typing); expect(typing.value).toBe('Still typing 中文');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  } finally { typing.remove(); }
});
it('updates snapshot status for later edits, undo and renaming after the file is ready', async () => {
  await start(); await finish(); const firstUrl = state.download!.url;
  await act(async () => { editor.commands.insertContent('Later '); });
  expect(state.download!.changedSinceStart).toBe(true);
  expect(state.download!.url).toBe(firstUrl); expect(calls.convert).toHaveBeenCalledOnce();
  await act(async () => { editor.commands.undo(); });
  expect(state.download!.changedSinceStart).toBe(false);
  await render('Renamed after export'); expect(state.download!.changedSinceStart).toBe(true);
  await render(); expect(state.download!.changedSinceStart).toBe(false);
});
it('preserves the body focus and composition state when a background export finishes', async () => {
  document.body.appendChild(editor.view.dom);
  try {
    await start(); editor.view.focus();
    Object.defineProperty(editor.view, 'composing', { configurable: true, value: true });
    const before = editor.getJSON(); await finish();
    expect(document.activeElement).toBe(editor.view.dom); expect(editor.view.composing).toBe(true);
    expect(editor.getJSON()).toEqual(before);
  } finally { editor.view.dom.remove(); }
});
it('does not flag edits undone before conversion ends or selection-only changes after it ends', async () => {
  await start(); editor.commands.insertContent('Temporary '); editor.commands.undo(); await finish();
  expect(state.download!.changedSinceStart).toBe(false);
  await act(async () => { editor.commands.setTextSelection(4); });
  expect(state.download!.changedSinceStart).toBe(false);
});
it('regenerates from changes made after completion and dismisses the ready file without changing the draft', async () => {
  await start(); await finish(); const originalUrl = state.download!.url;
  await act(async () => { editor.commands.insertContent('Newer draft '); }); const latest = editor.getJSON();
  await act(async () => Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Regenerate with latest edits')!.click());
  expect(calls.convert).toHaveBeenLastCalledWith(latest, 'Current draft'); expect(revokeUrl).toHaveBeenCalledWith(originalUrl);
  await finish(1); expect(state.download!.changedSinceStart).toBe(false); const latestUrl = state.download!.url;
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Dismiss Word download"]')!.click());
  expect(state.download).toBeNull(); expect(editor.getJSON()).toEqual(latest); expect(revokeUrl).toHaveBeenCalledWith(latestUrl);
  await act(async () => { editor.commands.insertContent('Still editing '); }); expect(state.download).toBeNull();
});

const blobBytes = (blob: Blob) => new Promise<ArrayBuffer>((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(blob);
});
const contentText = (node: JSONContent): string => node.text ?? (node.content ?? []).map(contentText).join('');
const walk = (node: JSONContent): JSONContent[] => [node, ...(node.content ?? []).flatMap(walk)];
async function realWord() { return vi.importActual<typeof import('../lib/infrastructure/word/word')>('../lib/infrastructure/word/word'); }
async function inspectWord(blob: Blob) {
  const bytes = await blobBytes(blob), real = await realWord(), imported = await real.importWord(bytes);
  const zip = await JSZip.loadAsync(bytes), core = new DOMParser().parseFromString(await zip.file('docProps/core.xml')!.async('string'), 'application/xml');
  expect(imported.warnings).toEqual([]);
  return { content: imported.content, title: core.getElementsByTagName('dc:title')[0]?.textContent };
}
async function mixedDraft() {
  await act(async () => editor.commands.setContent('<h2>Export baseline 中文</h2><p><strong>日本語 العربية café 👩‍💻</strong></p><ol start="7"><li><p>Numbered text</p></li></ol><table><tr><td rowspan="2"><p>Merged 中文</p></td><td><p>A</p></td></tr><tr><td><p>B</p></td></tr></table>'));
  return editor.getJSON();
}
it('delivers real snapshot bytes, backs up the newer draft, then regenerates Word with the latest title and merged content', async () => {
  const real = await realWord(), baseline = await mixedDraft(); let release!: () => void, encoded!: Promise<Blob>;
  const gate = new Promise<void>(resolve => { release = resolve; });
  calls.convert.mockImplementation((content, title) => { encoded = real.exportWord(content, title); return encoded.then(async blob => { await gate; return blob; }); });
  await start(); await act(async () => editor.commands.insertContentAt(1, 'NEWER العربية ')); await render('Newer title 中文');
  const latest = editor.getJSON(); await act(async () => { release(); await encoded; });
  expect(state.download!.changedSinceStart).toBe(true);
  const first = await inspectWord(createUrl.mock.calls[0][0]); expect(first.title).toBe('Current draft'); expect(contentText(first.content)).toBe(contentText(baseline));
  // A recovery backup uses the live editor, independently of the older Word snapshot.
  const { exportLocalDocument } = await import('../components/editor/local-export');
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  expect(exportLocalDocument(editor, 'Newer title 中文', 'json')).toBe(true);
  const backup = JSON.parse(new TextDecoder().decode(await blobBytes(createUrl.mock.calls[1][0])));
  expect(backup.title).toBe('Newer title 中文'); expect(backup.content).toEqual(latest);
  calls.convert.mockImplementation(real.exportWord); await act(async () => state.request('docx'));
  const updated = await inspectWord(createUrl.mock.calls[2][0]); expect(updated.title).toBe('Newer title 中文'); expect(contentText(updated.content)).toBe(contentText(latest));
  const table = walk(updated.content).find(node => node.type === 'table')!;
  expect(table.content!.map(row => row.content!.map(cell => cell.attrs?.rowspan ?? 1))).toEqual([[2, 1], [1]]);
  expect(walk(updated.content).find(node => node.type === 'orderedList')?.attrs?.start).toBe(7);
  expect(state.download!.changedSinceStart).toBe(false); expect(editor.getJSON()).toEqual(latest);
});
it('retries real Word conversion after URL allocation fails using edits made after the failure', async () => {
  const real = await realWord(); calls.convert.mockImplementation(real.exportWord); const baseline = await mixedDraft();
  createUrl.mockImplementationOnce(() => { throw new Error('Cannot allocate download'); });
  await act(async () => state.request('docx')); expect(state.download).toBeNull(); expect(state.busy).toBe(false); expect(editor.getJSON()).toEqual(baseline);
  expect(calls.error).toHaveBeenCalledWith('Cannot allocate download');
  await act(async () => editor.commands.insertContentAt(1, 'Retry latest 日本語 ')); const latest = editor.getJSON();
  await act(async () => state.request('docx')); const exported = await inspectWord(createUrl.mock.calls[1][0]);
  expect(contentText(exported.content)).toBe(contentText(latest)); expect(state.download!.changedSinceStart).toBe(false); expect(editor.getJSON()).toEqual(latest);
});
it('discards a real completed Word file if its workspace unmounts before the result is delivered', async () => {
  const real = await realWord(); let release!: () => void, encoded!: Promise<Blob>;
  const gate = new Promise<void>(resolve => { release = resolve; });
  calls.convert.mockImplementation((content, title) => { encoded = real.exportWord(content, title); return encoded.then(async blob => { await gate; return blob; }); });
  const before = await mixedDraft(); await start(); const bytes = await encoded;
  act(() => root.unmount()); await act(async () => release());
  expect(createUrl).not.toHaveBeenCalled(); expect(calls.error).not.toHaveBeenCalled(); expect(editor.getJSON()).toEqual(before);
  expect(contentText((await inspectWord(bytes)).content)).toBe(contentText(before));
});
it('does not attach a late real Word file to a newly opened document or overwrite its ready download', async () => {
  const real = await realWord(); let release!: () => void, encoded!: Promise<Blob>;
  const gate = new Promise<void>(resolve => { release = resolve; });
  calls.convert.mockImplementationOnce((content, title) => { encoded = real.exportWord(content, title); return encoded.then(async blob => { await gate; return blob; }); });
  await mixedDraft(); await start(); await encoded; const old = editor;
  try {
    editor = new Editor({ extensions: createExtensions(), content: '<p>New document हिन्दी עברית</p>' }); await render('New document');
    calls.convert.mockImplementation(real.exportWord); await act(async () => state.request('docx')); const ready = state.download;
    await act(async () => release()); expect(state.download).toEqual(ready); expect(createUrl).toHaveBeenCalledOnce();
    const exported = await inspectWord(createUrl.mock.calls[0][0]); expect(exported.title).toBe('New document'); expect(contentText(exported.content)).toBe('New document हिन्दी עברית');
    expect(calls.error).not.toHaveBeenCalled();
  } finally { old.destroy(); }
});
