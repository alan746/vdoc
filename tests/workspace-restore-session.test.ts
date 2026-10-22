import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import VdocWorkspace from '../components/editor/workspace';
import type { DocumentEngine } from '../lib/usecases/engine';

const fixture = vi.hoisted(() => {
  const content = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
  const timestamp = '2026-10-06T12:00:00.000Z';
  return {
    initial: { version: 1, id: 'restore-session', title: 'Current draft', savedAt: timestamp, content: content('Current body 中文') },
    restored: { version: 1, id: 'restore-session', title: 'Restored title العربية', savedAt: timestamp, content: content('Restored body 日本語') },
    save: vi.fn(), restore: vi.fn(), engines: [] as DocumentEngine[],
  };
});
vi.mock('../lib/infrastructure/persistence/document-store', () => ({
  STORAGE_KEY: 'vdoc.document.v1',
  readSavedDocument: async () => ({ data: fixture.initial }),
  saveDocument: fixture.save,
  listVersions: async () => [{ key: 'checkpoint', label: 'Earlier checkpoint', createdAt: fixture.initial.savedAt }],
  restoreVersion: fixture.restore,
}));
vi.mock('../lib/usecases/browser-tools', () => ({ registerDocumentTools: (engine: DocumentEngine) => { fixture.engines.push(engine); return () => {}; } }));
let root: Root, mount: HTMLDivElement;
const activeEngine = () => fixture.engines.at(-1)!;
const title = () => mount.querySelector<HTMLInputElement>('[aria-label="Document title"]')!.value;
const button = (label: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === label || button.getAttribute('aria-label') === label)!;
async function click(label: string) { await act(async () => button(label).click()); }
async function restore() { if (!button('Saved versions')) await click('Edit history'); await click('Saved versions'); await act(async () => document.querySelector<HTMLButtonElement>('.local-documents button')!.click()); }
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  window.history.replaceState(null, '', '/#document=restore-session');
  fixture.engines.length = 0;
  fixture.save.mockReset().mockImplementation(async (title, content, id) => ({ ...fixture.initial, title, content, id }));
  fixture.restore.mockReset().mockResolvedValue(fixture.restored);
  mount = document.createElement('div'); document.body.appendChild(mount); root = createRoot(mount);
  await act(async () => { root.render(createElement(VdocWorkspace)); });
});
afterEach(async () => {
  act(() => root.unmount()); await new Promise(resolve => setTimeout(resolve, 5)); mount.remove();
  window.history.replaceState(null, '', '/'); vi.unstubAllGlobals(); vi.restoreAllMocks();
});
it('opens the restored content in a fresh session even when its saved timestamp is unchanged', async () => {
  const original = activeEngine(); expect(original.editor.getText()).toBe('Current body 中文');
  const oldSnapshot = original.snapshot();
  await restore();
  expect(title()).toBe(fixture.restored.title);
  expect(activeEngine()).not.toBe(original); expect(activeEngine().editor.getText()).toBe('Restored body 日本語');
  expect(activeEngine().executeExternal({ expectedSessionId: oldSnapshot.sessionId, expectedRevision: oldSnapshot.revision,
    target: { kind: 'block', id: oldSnapshot.blocks[0].id }, operations: [{ type: 'text.replace', text: 'Stale write' }] })).toMatchObject({ ok: false, code: 'STALE' });
  expect(activeEngine().editor.can().undo()).toBe(false);
  await act(async () => new Promise(resolve => setTimeout(resolve, 500)));
  expect(fixture.save.mock.lastCall![0]).toBe(fixture.restored.title);
  expect(JSON.stringify(fixture.save.mock.lastCall![1])).toContain('Restored body 日本語');
  expect(JSON.stringify(fixture.save.mock.lastCall![1])).not.toContain('Current body');
});
it('keeps separate sessions and undo histories through consecutive same-timestamp restores', async () => {
  await restore(); const first = activeEngine();
  await act(async () => { first.editor.commands.insertContent('Temporary edit '); });
  const before = first.editor.getJSON();
  fixture.restore.mockResolvedValueOnce({ ...fixture.initial, title: 'Second restoration' });
  await restore();
  expect(activeEngine()).not.toBe(first); expect(title()).toBe('Second restoration');
  expect(activeEngine().editor.getText()).toBe('Current body 中文'); expect(activeEngine().editor.can().undo()).toBe(false);
  expect(fixture.restore.mock.lastCall![1].content).toEqual(before);
});
it('keeps the same editing session and undo history when storage restoration fails', async () => {
  const original = activeEngine(); await act(async () => { original.editor.commands.insertContent('Unsaved edit '); });
  const before = original.editor.getJSON(); fixture.restore.mockRejectedValueOnce(new Error('Restore failed'));
  await restore(); expect(activeEngine()).toBe(original); expect(original.editor.getJSON()).toEqual(before);
  expect(title()).toBe(fixture.initial.title); expect(original.editor.can().undo()).toBe(true);
});
