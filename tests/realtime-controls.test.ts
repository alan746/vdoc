import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Editor } from '@tiptap/core';
import { createExtensions } from '../lib/editor/extensions';
import { DocumentEngine } from '../lib/usecases/engine';
import { documentNavigation } from '../lib/usecases/document-navigation';
import { RealtimeControls } from '../components/editor/realtime-controls';
const calls = vi.hoisted(() => ({ interrupt: vi.fn(), close: vi.fn(), open: vi.fn(), enabled: true }));
vi.mock('../lib/composition/realtime', () => ({
  readRealtimeConfig: () => calls.enabled ? { url: 'ws://localhost:8790', tokenUrl: '/token' } : null,
  openDocumentRealtime: (options: { onStatus: (state: string) => void }) => { calls.open(); options.onStatus('connected'); return { interrupt: calls.interrupt, close: calls.close, sendText: vi.fn() }; },
}));
let editor: Editor, engine: DocumentEngine, root: Root, mount: HTMLDivElement;
const render = (docId = 'doc') => act(async () => root.render(createElement(RealtimeControls, { key: docId, engine, docId })));
const click = async (text: string) => act(async () => { [...mount.querySelectorAll('button')].find(button => button.textContent === text)!.click(); });
const escape = (init: KeyboardEventInit = {}) => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, ...init }));
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); calls.enabled = true; calls.open.mockClear(); calls.interrupt.mockClear(); calls.close.mockClear();
  editor = new Editor({ extensions: createExtensions(), content: '<p>hello</p>' }); await new Promise(resolve => setTimeout(resolve, 0)); engine = new DocumentEngine(editor);
  mount = document.createElement('div'); document.body.appendChild(mount); root = createRoot(mount);
});
afterEach(() => { act(() => root.unmount()); engine.destroy(); editor.destroy(); mount.remove(); vi.unstubAllGlobals(); });
it('makes no connection or controls when locally disabled', async () => {
  calls.enabled = false; await render(); expect(mount.textContent).toBe(''); expect(calls.open).not.toHaveBeenCalled();
});
it('connects on a user gesture and routes Stop and Escape to interrupt', async () => {
  await render(); expect(calls.open).not.toHaveBeenCalled(); await click('Connect assistant');
  await click('Stop assistant'); expect(calls.interrupt).toHaveBeenCalledOnce(); escape(); expect(calls.interrupt).toHaveBeenLastCalledWith('keyboard');
});
it('leaves Escape to dialogs and active composition', async () => {
  await render(); await click('Connect assistant');
  const dialog = document.createElement('div'); dialog.setAttribute('role', 'dialog'); document.body.appendChild(dialog);
  escape(); dialog.remove(); escape({ isComposing: true }); escape({ keyCode: 229 });
  const release = documentNavigation(editor).registerCompositionGuard(() => true); escape(); release();
  expect(calls.interrupt).not.toHaveBeenCalled(); escape(); expect(calls.interrupt).toHaveBeenCalledOnce();
});
it('closes on document switch, library/unmount and explicit disconnect', async () => {
  await render(); await click('Connect assistant'); await render('next'); expect(calls.close).toHaveBeenCalledTimes(1);
  await click('Connect assistant'); await click('Disconnect assistant'); expect(calls.close).toHaveBeenCalledTimes(2);
  await click('Connect assistant'); await act(async () => root.render(null)); expect(calls.close).toHaveBeenCalledTimes(3);
});
