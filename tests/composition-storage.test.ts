import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { act, createElement, useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Editor } from '@tiptap/core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createExtensions } from '../lib/editor/extensions';
import { useInputComposition } from '../components/editor/use-input-composition';
import { useLatest } from '../components/editor/use-latest';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../components/ui/dialog';
import type { startAutosave } from '../lib/composition/autosave';

let root: Root, mount: HTMLDivElement, editor: Editor, unmounted: boolean;
let controller: ReturnType<typeof startAutosave>;
let store: typeof import('../lib/infrastructure/persistence/document-store');
let autosave: typeof import('../lib/composition/autosave');
let navigation: ReturnType<typeof import('../lib/usecases/document-navigation').documentNavigation>;
const report = vi.fn();
let currentTitle: string;
function Harness() {
  const [title, setTitle] = useState('Baseline'), [open, setOpen] = useState(false);
  useLayoutEffect(() => { currentTitle = title; }, [title]);
  const titleRef = useLatest(title);
  const body = useCallback((node: HTMLDivElement | null) => { node?.appendChild(editor.view.dom); }, []);
  const composition = useInputComposition();
  useEffect(() => {
    const unregister = navigation.registerCompositionGuard(composition.hasComposition);
    controller = autosave.startAutosave(editor, 'composition-storage', {
      getTitle: () => titleRef.current, blocked: { current: false }, report,
      composition: { active: composition.hasComposition, subscribe: composition.subscribe },
    });
    return () => { controller.dispose(); unregister(); };
  }, [composition.hasComposition, composition.subscribe, titleRef]);
  useEffect(() => { controller.schedule(); }, [title]);
  return createElement('div', composition.capture,
    createElement('input', { 'aria-label': 'Title', value: title, onChange: e => setTitle(e.target.value) }),
    createElement('button', { onClick: () => setOpen(true) }, 'Open draft dialog'),
    createElement('div', { ref: body }),
    createElement(Dialog, { open, onOpenChange: setOpen },
      createElement(DialogContent, null,
        createElement(DialogTitle, null, 'Unapplied draft'),
        createElement(DialogDescription, null, 'Closing discards only this field draft.'),
        createElement('input', { 'aria-label': 'Dialog draft', defaultValue: '未应用 العربية' }))));
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); report.mockReset(); unmounted = false;
  localStorage.clear(); globalThis.indexedDB = new IDBFactory(); vi.resetModules();
  store = await import('../lib/infrastructure/persistence/document-store'); autosave = await import('../lib/composition/autosave');
  editor = new Editor({ extensions: createExtensions(), content: '<p>Keep 中文 العربية 日本語 café 👩‍💻</p>' });
  await new Promise(resolve => setTimeout(resolve, 0));
  navigation = (await import('../lib/usecases/document-navigation')).documentNavigation(editor);
  await store.activateDocument({ version: 1, id: 'composition-storage', title: 'Baseline', content: editor.getJSON(), savedAt: new Date().toISOString() });
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  mount = document.createElement('div'); document.body.appendChild(mount); root = createRoot(mount);
  await act(async () => root.render(createElement(Harness)));
  await act(async () => controller.flush());
  expect(report.mock.lastCall![0]).toBe('Saved locally');
});
afterEach(() => {
  if (!unmounted) act(() => root.unmount());
  editor.destroy(); mount.remove(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
const title = () => mount.querySelector<HTMLInputElement>('[aria-label="Title"]')!;
const compose = async (target: HTMLElement, type: string) => { await act(async () => target.dispatchEvent(new CompositionEvent(type, { bubbles: true }))); };
async function finishSave() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(450);
    await vi.waitFor(() => expect(report.mock.lastCall![0]).toBe('Saved locally'));
  });
}
async function updateTitle(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(title(), value);
    title().dispatchEvent(new Event('input', { bubbles: true }));
  });
}
it.each(['compositionend', 'blur'])('persists the final title and body after %s, with a matching library summary', async finish => {
  await act(async () => title().focus()); await compose(title(), 'compositionstart');
  await updateTitle('最终标题 العربية 日本語');
  await act(async () => editor.commands.insertContent('Latest 👩‍💻 '));
  const expected = editor.getJSON();
  await act(async () => controller.flush());
  expect(report.mock.lastCall![0]).toBe('Finishing input…');
  if (finish === 'blur') await act(async () => title().blur()); else await compose(title(), finish);
  await finishSave();
  expect((await store.readSavedDocument()).data).toMatchObject({ id: 'composition-storage', title: currentTitle, content: expected });
  expect((await store.listDocuments()).find(n => n.id === 'composition-storage')?.title).toBe(currentTitle);
  expect(navigation.isComposing()).toBe(false);
});
it.each(['title', 'body'])('cancels a %s candidate without duplicating text or leaving navigation locked', async field => {
  const before = editor.getJSON(), input = field === 'title' ? title() : editor.view.dom;
  await compose(input, 'compositionstart'); await act(async () => controller.flush());
  expect(report.mock.lastCall![0]).toBe('Finishing input…');
  expect(navigation.acquire()).toBe(true); expect(() => navigation.freeze()).toThrow('Finish composing'); navigation.release();
  await compose(input, 'compositionend'); await finishSave();
  expect((await store.readSavedDocument()).data!.content).toEqual(before);
  expect(navigation.acquire()).toBe(true); expect(() => navigation.freeze()).not.toThrow(); navigation.release();
});
it('clears a removed portal candidate, resumes saving and keeps unapplied dialog text out of the stored document', async () => {
  const before = editor.getJSON();
  await act(async () => mount.querySelector('button')!.click());
  const field = document.querySelector<HTMLInputElement>('[aria-label="Dialog draft"]')!;
  await compose(field, 'compositionstart'); await act(async () => controller.flush());
  expect(report.mock.lastCall![0]).toBe('Finishing input…'); expect(navigation.isComposing()).toBe(true);
  await act(async () => document.querySelector<HTMLButtonElement>('[data-slot="dialog-close"]')!.click());
  expect(field.isConnected).toBe(false); await finishSave();
  expect(navigation.isComposing()).toBe(false);
  expect((await store.readSavedDocument()).data).toMatchObject({ title: 'Baseline', content: before });
  await compose(title(), 'compositionstart'); expect(navigation.isComposing()).toBe(true);
  await compose(title(), 'compositionend'); await finishSave();
});
it('backs up the final candidate draft after a storage abort, then retries the newest edit without damaging the saved baseline', async () => {
  const baseline = await store.openArchivedDocument('composition-storage');
  const put = IDBObjectStore.prototype.put;
  const failure = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function(this: IDBObjectStore, value, key) {
    if (this.name === 'summaries') return this.add(value); // Existing key aborts the entire transaction.
    return key === undefined ? put.call(this, value) : put.call(this, value, key);
  });
  await compose(title(), 'compositionstart'); await updateTitle('未保存标题 العربية');
  await act(async () => editor.commands.insertContent('未保存草稿 '));
  await compose(title(), 'compositionend'); await act(async () => controller.flush());
  expect(report.mock.lastCall![0]).toBe('Save failed. Download a backup.');
  expect(await store.openArchivedDocument('composition-storage')).toEqual(baseline);
  const draft = editor.getJSON(); let blob: Blob | undefined;
  vi.stubGlobal('URL', class extends URL { static createObjectURL(value: Blob) { blob = value; return 'blob:composition-draft'; } static revokeObjectURL() {} });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const { exportLocalDocument } = await import('../components/editor/local-export');
  expect(exportLocalDocument(editor, currentTitle, 'json')).toBe(true);
  const raw = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.onerror = reject; reader.readAsText(blob!); });
  const backup = (await import('../lib/infrastructure/persistence/storage')).parseDocument(raw);
  expect(backup.title).toBe(currentTitle); expect(backup.content).toEqual(draft);
  const leaving = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(leaving); expect(leaving.defaultPrevented).toBe(true);
  await vi.waitFor(() => expect(report.mock.lastCall![0]).toBe('Save failed. Download a backup.'));
  failure.mockRestore(); await updateTitle('已恢复 最新 日本語'); await act(async () => editor.commands.insertContent('After backup '));
  const latest = editor.getJSON(); await act(async () => controller.flush());
  expect(report.mock.lastCall![0]).toBe('Saved locally');
  expect((await store.readSavedDocument()).data).toMatchObject({ title: currentTitle, content: latest });
  expect(backup.content).toEqual(draft);
});
it('does not let queued completion from a closed workspace overwrite the next active document', async () => {
  const baseline = await store.openArchivedDocument('composition-storage');
  await compose(title(), 'compositionstart'); await updateTitle('Pending title');
  await act(async () => {
    title().dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    root.unmount(); unmounted = true;
  });
  const next = await store.activateDocument({ ...baseline, id: 'next-document', title: 'Next safe document' });
  await vi.advanceTimersByTimeAsync(2500);
  expect((await store.readSavedDocument()).data).toEqual(next);
  expect(await store.openArchivedDocument('composition-storage')).toEqual(baseline);
});
