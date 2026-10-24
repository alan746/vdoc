import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Editor } from '@tiptap/core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createExtensions } from '../lib/editor/extensions';
import { documentNavigation } from '../lib/usecases/document-navigation';
import { DocumentAccountMenu } from '../components/editor/document-account-menu';

const calls = vi.hoisted(() => ({ save: vi.fn(), error: vi.fn() }));
vi.mock('../lib/infrastructure/persistence/document-store', () => ({ saveDocument: calls.save }));
vi.mock('sonner', () => ({ toast: { error: calls.error } }));
let editor: Editor, root: Root, mount: HTMLDivElement;
let writes: { resolve: () => void; reject: (error: Error) => void }[];
const assign = vi.fn(), replace = vi.fn(), fetcher = vi.fn();
const avatar = () => mount.querySelector<HTMLAnchorElement>('[aria-label="Your account"]')!;
async function render(title = 'Current draft', blocked: boolean | { current: boolean } = false) {
  await act(async () => root.render(createElement(DocumentAccountMenu, { editor, title, blocked, documentId: 'current' })));
}
async function click(selector = '[aria-label="Your account"]') {
  await act(async () => mount.querySelector<HTMLElement>(selector)!.click());
}
async function complete(index: number) { await act(async () => writes[index].resolve()); }
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  writes = []; calls.save.mockReset().mockImplementation(() => new Promise<void>((resolve, reject) => writes.push({ resolve, reject })));
  calls.error.mockReset(); assign.mockReset(); replace.mockReset(); fetcher.mockReset();
  fetcher.mockResolvedValue(Response.json({ configured: true, user: null })); vi.stubGlobal('fetch', fetcher);
  const originalWindow = window;
  vi.stubGlobal('window', new Proxy(originalWindow, { get: (target, key) => key === 'location' ? { assign, replace } : Reflect.get(target, key) }));
  editor = new Editor({ extensions: createExtensions(), content: '<p>Keep 中文 العربية</p>' });
  await new Promise(resolve => setTimeout(resolve, 0));
  mount = document.createElement('div'); document.body.appendChild(mount); root = createRoot(mount);
  await render();
});
afterEach(() => { act(() => root.unmount()); editor.destroy(); mount.remove(); vi.unstubAllGlobals(); });

it('opens the existing sign-in page only after the document is saved', async () => {
  expect(avatar().getAttribute('href')).toBe('/account');
  await click(); expect(assign).not.toHaveBeenCalled();
  expect(avatar().getAttribute('aria-disabled')).toBe('true');
  expect(calls.save).toHaveBeenCalledWith('Current draft', editor.getJSON(), 'current');
  await complete(0); expect(assign).toHaveBeenCalledOnce(); expect(new URL(assign.mock.calls[0][0]).pathname).toBe('/account');
});
it('saves edits and the latest title made during slow storage before opening the account', async () => {
  await click(); editor.commands.insertContent('Latest '); await render('Renamed draft');
  const latest = editor.getJSON(); await complete(0);
  expect(assign).not.toHaveBeenCalled(); expect(calls.save.mock.lastCall).toEqual(['Renamed draft', latest, 'current']);
  await complete(1); expect(assign).toHaveBeenCalledOnce();
});
it('keeps the document open on storage failure and lets the user retry', async () => {
  await click(); await act(async () => writes[0].reject(new Error('Storage full')));
  expect(assign).not.toHaveBeenCalled(); expect(calls.error).toHaveBeenCalledWith('Storage full');
  expect(avatar().hasAttribute('aria-disabled')).toBe(false);
  await click(); await complete(1); expect(assign).toHaveBeenCalledOnce();
});
it('uses the same save guard for the sign-in link in the account card', async () => {
  await act(async () => avatar().focus());
  await click('.account-pop-primary'); expect(assign).not.toHaveBeenCalled();
  await complete(0); expect(new URL(assign.mock.calls[0][0]).pathname).toBe('/account');
});
it('saves before switching workspaces through the account card', async () => {
  fetcher.mockResolvedValue(Response.json({ configured: true, user: { id: 'u1', name: 'Ada', email: 'ada@example.test' } }));
  act(() => root.unmount()); root = createRoot(mount); await render();
  await act(async () => avatar().focus()); await click('a[href="/cloud"]');
  expect(assign).not.toHaveBeenCalled(); await complete(0);
  expect(new URL(assign.mock.calls[0][0]).pathname).toBe('/cloud');
});
it('blocks duplicate clicks, competing navigation, paused saves and unfinished composition', async () => {
  await act(async () => { avatar().click(); avatar().click(); }); expect(calls.save).toHaveBeenCalledOnce();
  await complete(0); assign.mockClear(); calls.save.mockClear();
  const navigation = documentNavigation(editor); act(() => { navigation.acquire(); });
  await click(); act(() => navigation.release()); expect(calls.save).not.toHaveBeenCalled();
  await render('Current draft', true); await click(); expect(calls.save).not.toHaveBeenCalled();
  await render(); const unregister = navigation.registerCompositionGuard(() => true);
  await click(); unregister(); expect(calls.save).not.toHaveBeenCalled(); expect(assign).not.toHaveBeenCalled();
});
it('cancels navigation if saving becomes blocked or the menu unmounts', async () => {
  const blocked = { current: false }; await render('Current draft', blocked); await click();
  blocked.current = true; await complete(0); expect(assign).not.toHaveBeenCalled();
  blocked.current = false; await click(); act(() => root.unmount()); root = createRoot(mount);
  await complete(1); expect(assign).not.toHaveBeenCalled();
});
it('saves before signing out, freezes edits during the request, and restores editing on failure', async () => {
  fetcher.mockResolvedValue(Response.json({ configured: true, user: { id: 'u1', name: 'Ada', email: 'ada@example.test' } }));
  act(() => root.unmount()); root = createRoot(mount); await render();
  await act(async () => avatar().focus());
  let finish!: (response: Response) => void;
  fetcher.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const before = fetcher.mock.calls.length;
  await click('.account-pop-signout'); expect(fetcher).toHaveBeenCalledTimes(before);
  await complete(0); expect(fetcher.mock.lastCall?.[0]).toBe('/api/auth/sign-out');
  expect(editor.isEditable).toBe(false); const saved = editor.getJSON(); editor.commands.insertContent('Too late'); expect(editor.getJSON()).toEqual(saved);
  await act(async () => finish(new Response(null, { status: 503 })));
  expect(editor.isEditable).toBe(true); expect(replace).not.toHaveBeenCalled();
  expect(mount.querySelector('[role="alert"]')?.textContent).toContain('Sign-out failed');
});
