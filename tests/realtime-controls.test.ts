import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Editor } from '@tiptap/core';
import { createExtensions } from '../lib/editor/extensions';
import { DocumentEngine } from '../lib/usecases/engine';
import { documentNavigation } from '../lib/usecases/document-navigation';
import type { MicrophoneStatus, RealtimeStatus } from '../lib/usecases/ports';
import { VoiceConnectionError } from '../lib/composition/realtime';
import { RealtimeControls } from '../components/editor/realtime-controls';
const calls = vi.hoisted(() => ({ interrupt: vi.fn(), close: vi.fn(), open: vi.fn(), enabled: true, load: vi.fn(), onStatus: undefined as undefined | ((status: RealtimeStatus, message?: string) => void), onMicrophone: undefined as undefined | ((status: MicrophoneStatus) => void), onActivity: undefined as undefined | ((activity: unknown) => void) }));
vi.mock('../lib/composition/realtime', () => ({
  VoiceConnectionError: class extends Error {},
  loadRealtimeConfig: (...args: unknown[]) => calls.load(...args),
  openDocumentRealtime: (options: { onStatus: (state: RealtimeStatus, message?: string) => void; onMicrophone?: (status: MicrophoneStatus) => void; onActivity?: (activity: unknown) => void }) => { calls.open(options); calls.onStatus = options.onStatus; calls.onMicrophone = options.onMicrophone; calls.onActivity = options.onActivity; options.onStatus('connected'); return { interrupt: calls.interrupt, close: calls.close, sendText: vi.fn() }; },
}));
vi.mock('../lib/composition/repositories', () => ({ isCloudWorkspace: () => calls.enabled }));
let editor: Editor, engine: DocumentEngine, root: Root, mount: HTMLDivElement;
const render = (docId = 'doc') => act(async () => root.render(createElement(RealtimeControls, { key: docId, engine, docId })));
const click = async (text: string) => act(async () => { [...mount.querySelectorAll('button')].find(button => button.textContent === text)!.click(); });
const escape = (init: KeyboardEventInit = {}) => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, ...init }));
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); calls.enabled = true; calls.open.mockClear(); calls.interrupt.mockClear(); calls.close.mockClear(); calls.load.mockReset().mockResolvedValue({ url: 'ws://localhost:8790', sessionsUrl: '/api/voice-sessions', audio: true });
  editor = new Editor({ extensions: createExtensions(), content: '<p>hello</p>' }); await new Promise(resolve => setTimeout(resolve, 0)); engine = new DocumentEngine(editor);
  mount = document.createElement('div'); document.body.appendChild(mount); root = createRoot(mount);
});
afterEach(() => { act(() => root.unmount()); engine.destroy(); editor.destroy(); mount.remove(); vi.unstubAllGlobals(); });
it('shows immediate waiting and read/write progress before model text arrives', async () => {
  await render(); await click('Connect voice assistant');
  const output = () => mount.querySelector('[aria-label="Assistant live output"]')?.textContent;
  await act(async () => calls.onActivity!({ type: 'turn', state: 'thinking', turnId: 't' }));
  expect(output()).toContain('已收到，正在处理');
  await act(async () => calls.onActivity!({ type: 'call', name: 'get_context', callId: 'read', arguments: {} }));
  expect(output()).toContain('正在读取相关内容');
  await act(async () => calls.onActivity!({ type: 'result', name: 'get_context', callId: 'read', ok: true }));
  expect(output()).toContain('已读取，正在生成下一步操作');
  await act(async () => calls.onActivity!({ type: 'call', name: 'apply_document_operations', callId: 'write', arguments: {} }));
  expect(output()).toContain('正在修改文档');
  expect(editor.getText()).toBe('hello');
  await act(async () => calls.onActivity!({ type: 'result', name: 'apply_document_operations', callId: 'write', ok: false }));
  expect(output()).toContain('本次操作未完成');
  expect(output()).not.toContain('修改已完成');
});
it('keeps new spoken feedback visible after earlier worker progress', async () => {
  await render(); await click('Connect voice assistant');
  await act(async () => {
    calls.onActivity!({ type: 'text', responseId: 'worker', delta: '正在修改。' });
    calls.onActivity!({ type: 'transcript', role: 'agent', itemId: 'final', text: '修改已完成。', final: false });
  });
  const output = mount.querySelector('[aria-label="Assistant live output"]')?.textContent;
  expect(output).toContain('修改已完成。');
});
it('shows spoken acknowledgement and successive generated chunks before the document changes', async () => {
  await render(); await click('Connect voice assistant');
  await act(async () => calls.onActivity!({ type: 'transcript', role: 'agent', itemId: 'ack', text: '好的，我来修改。', final: false }));
  expect(mount.querySelector('[aria-label="Assistant live output"]')?.textContent).toContain('好的，我来修改。');
  await act(async () => calls.onActivity!({ type: 'preview', callId: 'write', phase: 'streaming', text: '第一段' }));
  expect(mount.querySelector('[aria-label="Generated content"]')?.textContent).toBe('第一段');
  await act(async () => calls.onActivity!({ type: 'preview', callId: 'write', phase: 'streaming', text: '第一段\n第二段<script>plain</script>' }));
  expect(mount.querySelector('[aria-label="Generated content"]')?.textContent).toContain('第二段<script>plain</script>');
  expect(mount.querySelector('script')).toBeNull();
  expect(editor.getText()).toBe('hello');
  await act(async () => calls.onActivity!({ type: 'interrupted' }));
  expect(mount.textContent).toContain('已停止生成');
  await click('Disconnect assistant');
  expect(mount.querySelector('[aria-label="Assistant live output"]')).toBeNull();
});
it('streams worker text and resets output for the next user request', async () => {
  await render(); await click('Connect voice assistant');
  await act(async () => {
    calls.onActivity!({ type: 'text', responseId: 'worker', delta: '正在' });
    calls.onActivity!({ type: 'text', responseId: 'worker', delta: '修改。' });
  });
  expect(mount.querySelector('[aria-label="Assistant live output"]')?.textContent).toContain('正在修改。');
  await act(async () => calls.onActivity!({ type: 'transcript', role: 'user', itemId: 'next', text: '下一项', final: false }));
  expect(mount.querySelector('[aria-label="Assistant live output"]')).toBeNull();
});
it('discovers local voice access without opening audio and connects only on a gesture', async () => {
  calls.enabled = false; await render();
  expect(calls.load).toHaveBeenCalledWith('doc', expect.any(AbortSignal), 'local');
  expect(mount.textContent).toContain('Using voice sends audio and document context to AI');
  expect(calls.open).not.toHaveBeenCalled();
  await click('Connect voice assistant'); expect(calls.open).toHaveBeenCalledOnce();
});
it('keeps local voice disabled when signed out and provides a sign-in entry', async () => {
  calls.enabled = false; calls.load.mockRejectedValueOnce(new VoiceConnectionError('Sign in to use the voice assistant.'));
  await render();
  expect(mount.querySelector<HTMLButtonElement>('.voice-orb')!.disabled).toBe(true);
  expect(mount.querySelector('a[href="/account"]')).not.toBeNull();
  expect(calls.open).not.toHaveBeenCalled();
});
it('connects on a user gesture and routes Stop and Escape to interrupt', async () => {
  await render(); expect(calls.open).not.toHaveBeenCalled(); await click('Connect voice assistant');
  await act(async () => calls.onActivity!({ type: 'turn', state: 'speaking', turnId: 't1' }));
  await click('Stop assistant'); expect(calls.interrupt).toHaveBeenCalledOnce(); escape(); expect(calls.interrupt).toHaveBeenLastCalledWith('keyboard');
});
it('leaves Escape to dialogs and active composition', async () => {
  await render(); await click('Connect voice assistant');
  const dialog = document.createElement('div'); dialog.setAttribute('role', 'dialog'); document.body.appendChild(dialog);
  escape(); dialog.remove(); escape({ isComposing: true }); escape({ keyCode: 229 });
  const release = documentNavigation(editor).registerCompositionGuard(() => true); escape(); release();
  expect(calls.interrupt).not.toHaveBeenCalled(); escape(); expect(calls.interrupt).toHaveBeenCalledOnce();
});
it('closes on document switch, library/unmount and explicit disconnect', async () => {
  await render(); await click('Connect voice assistant'); await render('next'); expect(calls.close).toHaveBeenCalledTimes(1);
  await click('Connect voice assistant'); await click('Disconnect assistant'); expect(calls.close).toHaveBeenCalledTimes(2);
  await click('Connect voice assistant'); await act(async () => root.render(null)); expect(calls.close).toHaveBeenCalledTimes(3);
});
it('vdoc#33: an agent commit highlights its block in the live editor and lists the turn', async () => {
  await render(); await click('Connect voice assistant');
  const s = engine.snapshot(), id = s.blocks[0].id;
  await act(async () => { engine.executeAgent({ expectedSessionId: s.sessionId, expectedRevision: s.revision, target: { kind: 'block', id }, operations: [{ type: 'text.replace', text: 'AI' }] }, { actor: 'agent', turnId: 'turn-1' }); });
  expect(editor.view.dom.querySelector('.vdoc-agent-highlight')?.textContent).toBe('AI');
  expect(editor.view.dom.querySelector('.vdoc-agent-presence')?.textContent).toBe('AI');
  expect(mount.querySelector('[aria-label="Assistant edit history"]')?.textContent).toContain('Undo turn');
});
it('vdoc#33: disconnecting clears the decorations and unmounting unregisters the plugins', async () => {
  const pluginCount = editor.state.plugins.length;
  await render(); expect(editor.state.plugins.length).toBe(pluginCount + 3);
  await click('Connect voice assistant');
  const s = engine.snapshot();
  await act(async () => { engine.executeAgent({ expectedSessionId: s.sessionId, expectedRevision: s.revision, target: { kind: 'block', id: s.blocks[0].id }, operations: [{ type: 'text.replace', text: 'AI' }] }, { actor: 'agent', turnId: 'turn-1' }); });
  await click('Disconnect assistant');
  expect(editor.view.dom.querySelectorAll('.vdoc-agent-highlight, .vdoc-agent-presence')).toHaveLength(0);
  await act(async () => root.render(null));
  expect(editor.state.plugins.length).toBe(pluginCount);
});
it('vdoc#33: registers nothing when the adapter is disabled', async () => {
  calls.load.mockRejectedValueOnce(new VoiceConnectionError('Voice unavailable')); const pluginCount = editor.state.plugins.length;
  await render(); expect(editor.state.plugins.length).toBe(pluginCount);
});
it('vdoc#33: shows the provider turn state next to the connection status', async () => {
  await render(); await click('Connect voice assistant');
  const status = () => mount.querySelector('[role="status"]')!.textContent;
  await act(async () => calls.onActivity!({ type: 'turn', state: 'thinking', turnId: 't1' }));
  expect(status()).toBe('Assistant connected · Thinking');
  await act(async () => calls.onActivity!({ type: 'turn', state: 'acting', turnId: 't1' }));
  expect(status()).toBe('Assistant connected · Editing');
  await act(async () => calls.onActivity!({ type: 'interrupted' }));
  expect(status()).toBe('Assistant connected');
});
it('vdoc#33: marks a call’s target block when the call arrives, before it commits, and clears it if the call fails', async () => {
  await render(); await click('Connect voice assistant');
  const id = engine.snapshot().blocks[0].id, presence = () => editor.view.dom.querySelector('.vdoc-agent-presence')?.textContent;
  await act(async () => calls.onActivity!({ type: 'call', callId: 'c1', name: 'apply_document_operations', arguments: { target: { kind: 'block', id } } }));
  expect(presence()).toBe('hello');
  await act(async () => calls.onActivity!({ type: 'result', callId: 'c1', ok: false }));
  expect(presence()).toBeUndefined();
});
it('vdoc#33: ignores call arguments that do not name a live block', async () => {
  await render(); await click('Connect voice assistant');
  for (const args of ['text', null, { target: 'b' }, { target: { kind: 'block', id: 'missing' } }, { target: { kind: 'selection' } }])
    await act(async () => calls.onActivity!({ type: 'call', callId: 'c', name: 'apply_document_operations', arguments: args }));
  expect(editor.view.dom.querySelector('.vdoc-agent-presence')).toBeNull();
});
it('vdoc#33: labels each turn in the timeline with what it did', async () => {
  await render(); await click('Connect voice assistant');
  const s = engine.snapshot();
  await act(async () => { engine.executeAgent({ expectedSessionId: s.sessionId, expectedRevision: s.revision, target: { kind: 'block', id: s.blocks[0].id }, operations: [{ type: 'text.replace', text: 'AI' }] }, { actor: 'agent', turnId: 'turn-1' }); });
  expect(mount.querySelector('[aria-label="Assistant edit history"]')?.textContent).toContain('Replace text');
});

it('displays availability errors with a retry and never opens audio on mount', async () => {
  calls.load.mockRejectedValueOnce(new VoiceConnectionError('Sign in again.'));
  await render(); expect(mount.querySelector('[role="alert"]')!.textContent).toContain('Sign in again.');
  expect(calls.open).not.toHaveBeenCalled();
  await click('Retry availability check');
  expect(mount.querySelector('[role="alert"]')).toBeNull();
  await click('Connect voice assistant'); expect(calls.open).toHaveBeenCalledOnce();
});
it('shows microphone permission, reconnection and quota errors without claiming microphone activity', async () => {
  await render(); await click('Connect voice assistant');
  await act(async () => { calls.onStatus!('connecting'); calls.onMicrophone!('requesting'); });
  expect(mount.textContent).toContain('Waiting for microphone permission');
  expect(mount.textContent).not.toContain('Microphone on');
  await act(async () => { calls.onStatus!('connected'); calls.onMicrophone!('on'); });
  expect(mount.textContent).toContain('Microphone on');
  await act(async () => calls.onStatus!('reconnecting'));
  expect(mount.textContent).toContain('Assistant reconnecting');
  await act(async () => calls.onStatus!('error', 'Voice quota is exhausted.'));
  expect(mount.querySelector('[role="alert"]')!.textContent).toContain('Voice quota is exhausted');
  expect(mount.textContent).toContain('Microphone off');
  await click('Retry voice connection'); expect(calls.open).toHaveBeenCalledTimes(2);
});
it('cancels permission/connection and ignores late status callbacks', async () => {
  await render(); await click('Connect voice assistant');
  const oldStatus = calls.onStatus!, oldMic = calls.onMicrophone!;
  await act(async () => { oldStatus('connecting'); oldMic('requesting'); });
  await click('Cancel connection');
  expect(calls.close).toHaveBeenCalledOnce();
  await act(async () => { oldStatus('connected'); oldMic('on'); });
  expect(mount.textContent).toContain('Assistant disconnected'); expect(mount.textContent).toContain('Microphone off');
});

it('keeps voice interaction inline without a typed chat form, and displays recognized speech', async () => {
  await render();
  expect(mount.querySelector('form, input, textarea, [role="dialog"]')).toBeNull();
  await click('Connect voice assistant');
  await act(async () => calls.onActivity!({ type: 'transcript', role: 'user', itemId: 'speech-1', text: '加一个三行四列的表格', final: true }));
  expect(mount.querySelector('.voice-hint')!.textContent).toBe('加一个三行四列的表格');
  await act(async () => calls.onActivity!({ type: 'transcript', role: 'agent', itemId: 'reply-1', text: '已完成', final: true }));
  expect(mount.querySelector('.voice-hint')!.textContent).toBe('加一个三行四列的表格');
  await click('Disconnect assistant');
  expect(mount.textContent).not.toContain('加一个三行四列的表格');
});
it('only claims a document update after the editing tool reports success', async () => {
  await render(); await click('Connect voice assistant');
  await act(async () => calls.onActivity!({ type: 'call', callId: 'c1', name: 'apply_document_operations', arguments: {} }));
  expect(mount.textContent).not.toContain('Document updated');
  await act(async () => calls.onActivity!({ type: 'result', callId: 'c1', name: 'apply_document_operations', ok: false, code: 'FAILED' }));
  expect(mount.querySelector('[role="alert"]')!.textContent).toContain('Couldn’t complete');
  expect(mount.textContent).not.toContain('Document updated');
  await act(async () => calls.onActivity!({ type: 'result', callId: 'c2', name: 'read_document', ok: true }));
  expect(mount.textContent).toContain('Document checked');
  await act(async () => calls.onActivity!({ type: 'result', callId: 'c3', name: 'apply_document_operations', ok: true }));
  expect(mount.textContent).toContain('Document updated');
});
it('sends the selected speech language and ignores late transcripts after disconnect', async () => {
  await render();
  const select = mount.querySelector('select')!;
  await act(async () => { select.value = 'zh-CN'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await click('Connect voice assistant');
  expect(calls.open).toHaveBeenLastCalledWith(expect.objectContaining({ config: expect.objectContaining({ language: 'zh-CN', audio: true }) }));
  const oldActivity = calls.onActivity!;
  await click('Disconnect assistant');
  await act(async () => oldActivity({ type: 'transcript', role: 'user', itemId: 'late', text: 'old document', final: true }));
  expect(mount.textContent).not.toContain('old document');
});

it('drives the glow only with captured input, clears on disconnect, and ignores stale input', async () => {
  await render(); await click('Connect voice assistant');
  const options = calls.open.mock.calls[0][0];
  const level = () => mount.querySelector<HTMLElement>('.voice-dock')!.style.getPropertyValue('--voice-level');
  expect(level()).toBe('0');
  await act(async () => calls.onActivity!({ type: 'turn', state: 'speaking', turnId: 't1' }));
  expect(level()).toBe('0');
  await act(async () => options.onInputLevel(1));
  expect(level()).toBe('1');
  await act(async () => options.onInputLevel(0));
  expect(level()).toBe('0');
  await click('Disconnect assistant');
  await act(async () => options.onInputLevel(1));
  expect(level()).toBe('0');
});

it('explains SDK-wrapped validation failures without exposing arbitrary message contents', async () => {
  await render(); await click('Connect voice assistant');
  await act(async () => calls.onActivity!({ type: 'result', callId: 'bad', ok: false, code: 'FAILED', message: 'INVALID: operations[0].rows: Expected number. private document text' }));
  expect(mount.querySelector('[role="alert"]')!.textContent).toContain('operations[0].rows');
  expect(mount.textContent).not.toContain('private document text');
  await act(async () => calls.onActivity!({ type: 'result', callId: 'stale', ok: false, code: 'FAILED', message: 'STALE: changed' }));
  expect(mount.querySelector('[role="alert"]')!.textContent).toContain('read it again');
});

it('retains a failed action in voice options after a successful read and disconnect', async () => {
  await render(); await click('Connect voice assistant');
  await act(async () => calls.onActivity!({ type: 'result', callId: 'bad', ok: false, code: 'FAILED', message: 'INVALID: operations[0].rows: Expected number' }));
  await act(async () => calls.onActivity!({ type: 'result', callId: 'read', name: 'read_document', ok: true }));
  await click('Disconnect assistant');
  expect(mount.querySelector('[aria-label="Recent voice failures"]')!.textContent).toContain('operations[0].rows');
  await render('another-document');
  expect(mount.querySelector('[aria-label="Recent voice failures"]')).toBeNull();
});
it('lights both ends of the bar by what the assistant is doing', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    await render();
    const dock = () => mount.querySelector<HTMLElement>('.voice-dock')!;
    expect(dock().dataset.lamp).toBe('off');
    expect(mount.querySelectorAll('.voice-field-inner > .voice-lamp')).toHaveLength(2);
    await click('Connect voice assistant');
    await act(async () => calls.onMicrophone!('on'));
    expect(dock().dataset.lamp).toBe('listening');
    await act(async () => calls.onActivity!({ type: 'turn', state: 'acting', turnId: 't1' }));
    expect(dock().dataset.lamp).toBe('working');
    expect(mount.textContent).toContain('press Stop to cancel');
    await act(async () => calls.onActivity!({ type: 'interrupted' }));
    expect(dock().dataset.lamp).toBe('interrupted');
    await act(async () => { vi.advanceTimersByTime(2500); });
    expect(dock().dataset.lamp).toBe('listening');
  } finally { vi.useRealTimers(); }
});
it('clears a failed instruction message once the next instruction starts', async () => {
  await render(); await click('Connect voice assistant');
  await act(async () => calls.onActivity!({ type: 'turn', state: 'thinking', turnId: 't1' }));
  await act(async () => calls.onStatus!('connected', 'The assistant could not complete that instruction. Try again.'));
  await act(async () => calls.onActivity!({ type: 'turn', state: 'idle', turnId: 't1' }));
  expect(mount.querySelector('[role="alert"]')?.textContent).toContain('could not complete');
  await act(async () => calls.onActivity!({ type: 'turn', state: 'listening', turnId: 't2' }));
  expect(mount.textContent).not.toContain('could not complete');
});

it('subscribes the editor to streamed writing and clears it on disconnect', async () => {
  await render(); await click('Connect voice assistant');
  await act(async () => calls.onActivity!({ type: 'preview', callId: 'write', phase: 'streaming', text: '正文草稿', drafts: [{ text: '正文草稿', anchor: { kind: 'document_end' } }] }));
  expect(editor.view.dom.querySelector('.vdoc-streaming-draft')?.textContent).toBe('正文草稿');
  expect(editor.getText()).toBe('hello');
  await click('Disconnect assistant');
  expect(editor.view.dom.querySelector('.vdoc-streaming-draft')).toBeNull();
});
it('shows Writing in the status light while content streams, until its call finishes', async () => {
  await render(); await click('Connect voice assistant');
  const light = () => mount.querySelector('.agent-status')?.textContent;
  await act(async () => { calls.onStatus!('connected'); calls.onMicrophone!('on'); });
  expect(light()).toBe('Listening');
  await act(async () => calls.onActivity!({ type: 'turn', state: 'thinking', turnId: 't1' }));
  expect(light()).toBe('Thinking');
  await act(async () => calls.onActivity!({ type: 'preview', callId: 'write', phase: 'streaming', text: '' }));
  expect(light()).toBe('Writing');
  await act(async () => calls.onActivity!({ type: 'result', callId: 'write', ok: true, name: 'insert_structured_article' }));
  expect(light()).toBe('Thinking');
  await click('Disconnect assistant');
  expect(light()).toBe('Idle');
});
