import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Editor } from '@tiptap/core';
import { createExtensions } from '../lib/editor/extensions';
import { DocumentEngine } from '../lib/usecases/engine';
import { documentNavigation } from '../lib/usecases/document-navigation';
import { RealtimeControls } from '../components/editor/realtime-controls';
const calls = vi.hoisted(() => ({ interrupt: vi.fn(), close: vi.fn(), open: vi.fn(), enabled: true, onActivity: undefined as undefined | ((activity: unknown) => void) }));
vi.mock('../lib/composition/realtime', () => ({
  readRealtimeConfig: () => calls.enabled ? { url: 'ws://localhost:8790', sessionsUrl: '/api/voice-sessions' } : null,
  openDocumentRealtime: (options: { onStatus: (state: string) => void; onActivity?: (activity: unknown) => void }) => { calls.open(); calls.onActivity = options.onActivity; options.onStatus('connected'); return { interrupt: calls.interrupt, close: calls.close, sendText: vi.fn() }; },
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
it('vdoc#33: an agent commit highlights its block in the live editor and lists the turn', async () => {
  await render(); await click('Connect assistant');
  const s = engine.snapshot(), id = s.blocks[0].id;
  await act(async () => { engine.executeAgent({ expectedSessionId: s.sessionId, expectedRevision: s.revision, target: { kind: 'block', id }, operations: [{ type: 'text.replace', text: 'AI' }] }, { actor: 'agent', turnId: 'turn-1' }); });
  expect(editor.view.dom.querySelector('.vdoc-agent-highlight')?.textContent).toBe('AI');
  expect(editor.view.dom.querySelector('.vdoc-agent-presence')?.textContent).toBe('AI');
  expect(mount.querySelector('[aria-label="Assistant edit history"]')?.textContent).toContain('Undo turn');
});
it('vdoc#33: disconnecting clears the decorations and unmounting unregisters the plugins', async () => {
  const pluginCount = editor.state.plugins.length;
  await render(); expect(editor.state.plugins.length).toBe(pluginCount + 2);
  await click('Connect assistant');
  const s = engine.snapshot();
  await act(async () => { engine.executeAgent({ expectedSessionId: s.sessionId, expectedRevision: s.revision, target: { kind: 'block', id: s.blocks[0].id }, operations: [{ type: 'text.replace', text: 'AI' }] }, { actor: 'agent', turnId: 'turn-1' }); });
  await click('Disconnect assistant');
  expect(editor.view.dom.querySelectorAll('.vdoc-agent-highlight, .vdoc-agent-presence')).toHaveLength(0);
  await act(async () => root.render(null));
  expect(editor.state.plugins.length).toBe(pluginCount);
});
it('vdoc#33: registers nothing when the adapter is disabled', async () => {
  calls.enabled = false; const pluginCount = editor.state.plugins.length;
  await render(); expect(editor.state.plugins.length).toBe(pluginCount);
});
it('vdoc#33: shows the provider turn state next to the connection status', async () => {
  await render(); await click('Connect assistant');
  const status = () => mount.querySelector('[role="status"]')!.textContent;
  await act(async () => calls.onActivity!({ type: 'turn', state: 'thinking', turnId: 't1' }));
  expect(status()).toBe('Assistant connected · Thinking');
  await act(async () => calls.onActivity!({ type: 'turn', state: 'acting', turnId: 't1' }));
  expect(status()).toBe('Assistant connected · Editing');
  await act(async () => calls.onActivity!({ type: 'interrupted' }));
  expect(status()).toBe('Assistant connected');
});
it('vdoc#33: marks a call’s target block when the call arrives, before it commits, and clears it if the call fails', async () => {
  await render(); await click('Connect assistant');
  const id = engine.snapshot().blocks[0].id, presence = () => editor.view.dom.querySelector('.vdoc-agent-presence')?.textContent;
  await act(async () => calls.onActivity!({ type: 'call', callId: 'c1', name: 'apply_document_operations', arguments: { target: { kind: 'block', id } } }));
  expect(presence()).toBe('hello');
  await act(async () => calls.onActivity!({ type: 'result', callId: 'c1', ok: false }));
  expect(presence()).toBeUndefined();
});
it('vdoc#33: ignores call arguments that do not name a live block', async () => {
  await render(); await click('Connect assistant');
  for (const args of ['text', null, { target: 'b' }, { target: { kind: 'block', id: 'missing' } }, { target: { kind: 'selection' } }])
    await act(async () => calls.onActivity!({ type: 'call', callId: 'c', name: 'apply_document_operations', arguments: args }));
  expect(editor.view.dom.querySelector('.vdoc-agent-presence')).toBeNull();
});
it('vdoc#33: labels each turn in the timeline with what it did', async () => {
  await render(); await click('Connect assistant');
  const s = engine.snapshot();
  await act(async () => { engine.executeAgent({ expectedSessionId: s.sessionId, expectedRevision: s.revision, target: { kind: 'block', id: s.blocks[0].id }, operations: [{ type: 'text.replace', text: 'AI' }] }, { actor: 'agent', turnId: 'turn-1' }); });
  expect(mount.querySelector('[aria-label="Assistant edit history"]')?.textContent).toContain('Replace text');
});
