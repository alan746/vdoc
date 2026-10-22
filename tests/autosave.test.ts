import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { createExtensions } from '../lib/editor/extensions';
import { startAutosave } from '../lib/editor/autosave';
import { documentNavigation } from '../lib/editor/document-navigation';
const calls = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock('../lib/editor/document-store', () => ({ saveDocument: calls.save, STORAGE_KEY: 'vdoc.document.v1' }));
let editor: Editor, controller: ReturnType<typeof startAutosave>, title: string;
let blocked: { current: boolean }, report: ReturnType<typeof vi.fn>;
let writes: { resolve: () => void; reject: (error: Error) => void }[];
beforeEach(async () => {
  editor = new Editor({ extensions: createExtensions(), content: '<p>Keep 中文 العربية</p>' });
  await new Promise(resolve => setTimeout(resolve, 0)); vi.useFakeTimers();
  title = 'Current draft'; blocked = { current: false }; report = vi.fn(); writes = [];
  calls.save.mockReset().mockImplementation(() => new Promise<void>((resolve, reject) => writes.push({ resolve, reject })));
  controller = startAutosave(editor, 'current', { getTitle: () => title, blocked, report });
});
afterEach(() => { controller.dispose(); editor.destroy(); vi.useRealTimers(); });
async function tick() { await vi.advanceTimersByTimeAsync(450); }
async function complete(index = 0) { writes[index].resolve(); await Promise.resolve(); }
function savedReports() { return report.mock.calls.filter(([status]) => status === 'Saved locally'); }
function composingInput() {
  controller.dispose(); let composing = false; const listeners = new Set<() => void>();
  controller = startAutosave(editor, 'current', { getTitle: () => title, blocked, report,
    composition: { active: () => composing, subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; } } });
  return (value: boolean) => { composing = value; listeners.forEach(listener => listener()); };
}
it('guards an unfinished candidate even if the last document snapshot was already saved', async () => {
  const compose = composingInput(); await tick(); await complete(); expect(leaving()).toBe(false);
  compose(true); expect(report.mock.lastCall![0]).not.toBe('Saved locally'); expect(leaving()).toBe(true);
  await complete(1); expect(report.mock.lastCall![0]).not.toBe('Saved locally');
  compose(false); await tick(); await complete(2); expect(leaving()).toBe(false);
  expect(report).toHaveBeenLastCalledWith('Saved locally', '');
});
it('does not acknowledge an older write completed while a candidate is active, and persists its final title', async () => {
  const compose = composingInput(); await tick(); compose(true); await complete();
  expect(savedReports()).toHaveLength(0);
  title = '最终标题 中文'; compose(false); await tick();
  expect(calls.save.mock.lastCall![0]).toBe(title); await complete(1);
  expect(report).toHaveBeenLastCalledWith('Saved locally', ''); expect(leaving()).toBe(false);
});
it('resaves after composition cancellation even when no document update event fires', async () => {
  const compose = composingInput(); await tick(); await complete();
  compose(true); compose(false); await tick(); expect(calls.save).toHaveBeenCalledTimes(2);
  await complete(1); expect(report).toHaveBeenLastCalledWith('Saved locally', ''); expect(leaving()).toBe(false);
});
it('keeps paused storage warnings through composition changes without attempting another write', async () => {
  const compose = composingInput(); await tick(); await complete();
  window.dispatchEvent(new StorageEvent('storage', { key: 'vdoc.document.v1' }));
  const count = report.mock.calls.length; compose(true); compose(false); await tick();
  expect(calls.save).toHaveBeenCalledOnce(); expect(leaving()).toBe(true);
  expect(report.mock.calls.slice(count).every(([status, warning]) => status === 'Autosave paused' && warning === undefined)).toBe(true);
});
it('removes composition listeners and leave protection when the controller is disposed', async () => {
  const compose = composingInput(); await tick(); await complete(); compose(true); controller.dispose();
  const count = report.mock.calls.length; compose(false); await tick();
  expect(report).toHaveBeenCalledTimes(count); expect(calls.save).toHaveBeenCalledOnce(); expect(leaving()).toBe(false);
});

it('reports saved only after the current snapshot completes', async () => {
  expect(report).toHaveBeenLastCalledWith('Saving…', undefined); await tick(); expect(savedReports()).toHaveLength(0);
  expect(calls.save).toHaveBeenCalledWith(title, editor.getJSON(), 'current'); await complete(); expect(report).toHaveBeenLastCalledWith('Saved locally', '');
});
it('does not claim that text typed during a pending save is saved', async () => {
  await tick(); editor.commands.insertContent('Latest '); await complete(); expect(savedReports()).toHaveLength(0);
  await tick(); expect(calls.save.mock.calls[1][1]).toEqual(editor.getJSON()); await complete(1); expect(savedReports()).toHaveLength(1);
});
it('serializes writes and coalesces rapid edits to the latest snapshot', async () => {
  await tick(); editor.commands.insertContent('First '); await tick(); editor.commands.insertContent('Second '); await tick();
  expect(calls.save).toHaveBeenCalledOnce(); await complete(); await tick(); expect(calls.save).toHaveBeenCalledTimes(2);
  expect(calls.save.mock.calls[1][1]).toEqual(editor.getJSON()); await complete(1);
});
it('waits for the latest title rather than acknowledging an older title', async () => {
  await tick(); title = 'Renamed أثناء الحفظ'; controller.schedule(); await complete(); expect(savedReports()).toHaveLength(0);
  await tick(); expect(calls.save.mock.calls[1][0]).toBe(title); await complete(1); expect(savedReports()).toHaveLength(1);
});
it('coalesces repeated pagehide events while an unchanged snapshot is saving', async () => {
  window.dispatchEvent(new Event('pagehide')); window.dispatchEvent(new Event('pagehide'));
  expect(calls.save).toHaveBeenCalledOnce(); await complete(); await tick(); expect(calls.save).toHaveBeenCalledOnce();
});
it('retains a save failure until another successful save and permits retry', async () => {
  await tick(); writes[0].reject(new Error('Storage full')); await Promise.resolve();
  expect(report).toHaveBeenLastCalledWith('Save failed. Download a backup.', expect.stringContaining('Storage full'));
  await tick(); expect(calls.save).toHaveBeenCalledOnce(); editor.commands.insertContent('Retry '); await tick(); await complete(1);
  expect(report).toHaveBeenLastCalledWith('Saved locally', '');
});
it('does not clear a conflict warning when an older save finishes successfully', async () => {
  await tick(); window.dispatchEvent(new StorageEvent('storage', { key: 'vdoc.document.v1' })); await complete(); await tick();
  expect(blocked.current).toBe(true); expect(savedReports()).toHaveLength(0); expect(calls.save).toHaveBeenCalledOnce();
  expect(report.mock.calls.some(([status, warning]) => status === 'Autosave paused' && warning?.includes('another tab'))).toBe(true);
  expect(report.mock.calls.some(([, warning]) => warning === '')).toBe(false);
});
it('ignores stale success and failure callbacks after disposal', async () => {
  await tick(); controller.dispose(); const count = report.mock.calls.length; await complete(); expect(report).toHaveBeenCalledTimes(count);
  controller = startAutosave(editor, 'current', { getTitle: () => title, blocked, report }); await tick(); controller.dispose();
  const nextCount = report.mock.calls.length; writes[1].reject(new Error('Late failure')); await Promise.resolve(); expect(report).toHaveBeenCalledTimes(nextCount);
});
it('pauses during final document activation and resumes if the editor stays open', async () => {
  const navigation = documentNavigation(editor); navigation.acquire(); navigation.freeze(); await tick();
  window.dispatchEvent(new Event('pagehide')); expect(calls.save).not.toHaveBeenCalled(); navigation.release();
  expect(calls.save).not.toHaveBeenCalled(); await tick(); expect(calls.save).toHaveBeenCalledOnce(); await complete();
});
it('cancels a resumed save if successful navigation unmounts the editor', async () => {
  const navigation = documentNavigation(editor); navigation.acquire(); navigation.freeze(); navigation.release(); controller.dispose();
  await tick(); expect(calls.save).not.toHaveBeenCalled();
});
it('does not report saved during a competing document commit', async () => {
  await tick(); const navigation = documentNavigation(editor); navigation.acquire(); navigation.freeze(); await complete();
  expect(savedReports()).toHaveLength(0); navigation.release(); await tick(); await complete(1); expect(savedReports()).toHaveLength(1);
});
it('does not save or discard recovery warnings when initially blocked', async () => {
  controller.dispose(); blocked.current = true; report.mockClear(); controller = startAutosave(editor, 'current', { getTitle: () => title, blocked, report });
  await tick(); window.dispatchEvent(new Event('pagehide')); expect(calls.save).not.toHaveBeenCalled();
  expect(report).toHaveBeenLastCalledWith('Autosave paused', undefined);
});

it('saves repeatedly during uninterrupted typing instead of waiting indefinitely for a pause', async () => {
  const savedAt: number[] = [];
  calls.save.mockImplementation(async () => { savedAt.push(Date.now()); });
  const started = Date.now();
  for (let i = 0; i < 30; i++) {
    editor.commands.insertContent(`输入${i} `);
    await vi.advanceTimersByTimeAsync(300);
  }
  expect(savedAt.length).toBeGreaterThanOrEqual(4);
  expect(savedAt[0] - started).toBeLessThanOrEqual(2000);
  for (let i = 1; i < savedAt.length; i++) expect(savedAt[i] - savedAt[i - 1]).toBeLessThanOrEqual(2300);
  await tick(); expect(calls.save.mock.lastCall![1]).toEqual(editor.getJSON());
  expect(report).toHaveBeenLastCalledWith('Saved locally', '');
});

it('does not postpone the two-second deadline when another edit arrives just before it', async () => {
  for (let i = 0; i < 4; i++) { await vi.advanceTimersByTimeAsync(400); editor.commands.insertContent('字'); }
  await vi.advanceTimersByTimeAsync(399); editor.commands.insertContent('最后');
  expect(calls.save).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1); expect(calls.save).toHaveBeenCalledOnce();
  expect(calls.save.mock.lastCall![1]).toEqual(editor.getJSON()); await complete();
});

it('bounds continuous title changes as well as body edits', async () => {
  for (let i = 0; i < 6; i++) { title = `标题 ${i} العربية`; controller.schedule(); await vi.advanceTimersByTimeAsync(300); }
  title = 'Latest title'; controller.schedule(); await vi.advanceTimersByTimeAsync(200);
  expect(calls.save).toHaveBeenCalledOnce(); expect(calls.save.mock.lastCall![0]).toBe('Latest title'); await complete();
});

it('saves the latest pending edits immediately after a slow write when their deadline has elapsed', async () => {
  await tick();
  for (let i = 0; i < 10; i++) { editor.commands.insertContent(`Edit ${i} `); await vi.advanceTimersByTimeAsync(300); }
  expect(calls.save).toHaveBeenCalledOnce(); expect(savedReports()).toHaveLength(0);
  const latest = editor.getJSON(); await complete(); await vi.advanceTimersByTimeAsync(0);
  expect(calls.save).toHaveBeenCalledTimes(2); expect(calls.save.mock.lastCall![1]).toEqual(latest);
  await complete(1); await vi.advanceTimersByTimeAsync(5000); expect(calls.save).toHaveBeenCalledTimes(2);
});

it('cancels the typing deadline during navigation and gives a resumed editor a fresh debounce window', async () => {
  for (let i = 0; i < 4; i++) { await vi.advanceTimersByTimeAsync(400); editor.commands.insertContent('字'); }
  const navigation = documentNavigation(editor); navigation.acquire(); navigation.freeze();
  await vi.advanceTimersByTimeAsync(5000); expect(calls.save).not.toHaveBeenCalled(); navigation.release();
  await vi.advanceTimersByTimeAsync(449); expect(calls.save).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1); expect(calls.save).toHaveBeenCalledOnce(); await complete();
});

it('disposes a pending typing deadline without a late save', async () => {
  for (let i = 0; i < 4; i++) { await vi.advanceTimersByTimeAsync(400); editor.commands.insertContent('字'); }
  controller.dispose(); await vi.advanceTimersByTimeAsync(5000); expect(calls.save).not.toHaveBeenCalled();
});

it('does not spin on an expired deadline after storage rejects a slow write', async () => {
  await tick();
  for (let i = 0; i < 8; i++) { editor.commands.insertContent('字'); await vi.advanceTimersByTimeAsync(300); }
  writes[0].reject(new Error('Storage full')); await Promise.resolve();
  await vi.advanceTimersByTimeAsync(449); expect(calls.save).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1); expect(calls.save).toHaveBeenCalledTimes(2);
  writes[1].reject(new Error('Still full')); await Promise.resolve();
  await vi.advanceTimersByTimeAsync(5000); expect(calls.save).toHaveBeenCalledTimes(2);
  expect(report).toHaveBeenLastCalledWith('Save failed. Download a backup.', expect.stringContaining('Still full'));
});

it('keeps the typing deadline when the system clock moves backwards', async () => {
  for (let i = 0; i < 3; i++) { await vi.advanceTimersByTimeAsync(400); editor.commands.insertContent('字'); }
  vi.setSystemTime(new Date(Date.now() - 60_000));
  await vi.advanceTimersByTimeAsync(400); editor.commands.insertContent('字');
  await vi.advanceTimersByTimeAsync(400); expect(calls.save).toHaveBeenCalledOnce(); await complete();
});

it('cancels the pending deadline when edits made during a write are undone to its original snapshot', async () => {
  await tick(); editor.commands.insertContent('Temporary '); editor.commands.undo(); await complete();
  expect(report).toHaveBeenLastCalledWith('Saved locally', '');
  await vi.advanceTimersByTimeAsync(5000); expect(calls.save).toHaveBeenCalledOnce();
});

function leaving() { const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented; }
it('guards an uncommitted draft and starts its pending save before the idle deadline',async()=>{
  expect(leaving()).toBe(true);expect(calls.save).toHaveBeenCalledOnce();await complete();expect(leaving()).toBe(false);
});
it('guards newer text until its own write completes, not merely an older write',async()=>{
  await tick();editor.commands.insertContent('Newer ');await complete();expect(leaving()).toBe(true);
  expect(calls.save.mock.lastCall![1]).toEqual(editor.getJSON());await complete(1);expect(leaving()).toBe(false);
});
it('guards title-only edits, and removes the browser listener once saved',async()=>{
  const remove=vi.spyOn(window,'removeEventListener');await tick();await complete();
  title='Unsaved title';controller.schedule();expect(leaving()).toBe(true);await complete(1);expect(leaving()).toBe(false);
  expect(remove).toHaveBeenCalledWith('beforeunload',expect.any(Function));remove.mockRestore();
});
it('keeps the leave warning after a storage failure and clears it after successful retry',async()=>{
  await tick();writes[0].reject(new Error('Storage full'));await Promise.resolve();expect(leaving()).toBe(true);
  expect(calls.save).toHaveBeenCalledTimes(2);await complete(1);expect(leaving()).toBe(false);
});
it('keeps guarding a draft reverted to the saved version while a different snapshot is still writing',async()=>{
  await tick();await complete();editor.commands.insertContent('Temporary ');await tick();editor.commands.undo();
  expect(leaving()).toBe(true);await complete(1);expect(leaving()).toBe(true);await complete(2);expect(leaving()).toBe(false);
});
it('does not warn for selection-only changes or an edit undone before any write starts',async()=>{
  await tick();await complete();editor.commands.setTextSelection(2);expect(leaving()).toBe(false);
  editor.commands.insertContent('Temporary ');editor.commands.undo();expect(leaving()).toBe(false);
});
it('keeps blocked drafts guarded without attempting a write',async()=>{
  await tick();await complete();window.dispatchEvent(new StorageEvent('storage',{key:'vdoc.document.v1'}));
  expect(leaving()).toBe(true);expect(calls.save).toHaveBeenCalledOnce();
});
it('removes the leave guard on disposal and ignores late save completion',async()=>{
  await tick();controller.dispose();expect(leaving()).toBe(false);await complete();expect(leaving()).toBe(false);
});

it('keeps the leave guard during a reading operation even when edits return to the last autosaved content', async () => {
  await tick(); await complete(); const navigation = documentNavigation(editor);
  editor.commands.insertContent('Manual save snapshot '); navigation.acquire(); editor.commands.undo();
  expect(leaving()).toBe(true);
  await complete(1); navigation.release();
});
it('revalidates the current draft after a manual document operation releases ownership', async () => {
  await tick(); await complete(); const navigation = documentNavigation(editor);
  navigation.acquire(); navigation.release();
  expect(report).toHaveBeenLastCalledWith('Saving…', undefined);
  await tick(); expect(calls.save).toHaveBeenCalledTimes(2);
  expect(leaving()).toBe(true); await complete(1); expect(leaving()).toBe(false);
});
it('does not acknowledge an autosave while another reading operation may still write a snapshot', async () => {
  await tick(); const navigation = documentNavigation(editor); navigation.acquire(); await complete();
  expect(savedReports()).toHaveLength(0);
  navigation.release(); await tick(); await complete(1); expect(savedReports()).toHaveLength(1);
});
it('keeps paused status and recovery warnings through a read-only version listing', async () => {
  await tick(); await complete(); window.dispatchEvent(new StorageEvent('storage', { key: 'vdoc.document.v1' }));
  const count = report.mock.calls.length, navigation = documentNavigation(editor);
  navigation.acquire(); expect(report).toHaveBeenLastCalledWith('Autosave paused', undefined);
  navigation.release(); await tick(); expect(calls.save).toHaveBeenCalledOnce();
  expect(report.mock.calls.slice(count).every(([status, warning]) => status === 'Autosave paused' && warning === undefined)).toBe(true);
  expect(leaving()).toBe(true);
});
