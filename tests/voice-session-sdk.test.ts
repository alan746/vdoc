import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ClientMessage, ServerMessage, Unsequenced } from '@vrealtime/protocol';
import { Editor } from '@tiptap/core';
import { createExtensions } from '../lib/editor/extensions';
import { DocumentEngine } from '../lib/usecases/engine';
import { openDocumentRealtime } from '../lib/composition/realtime';
import { documentNavigation } from '../lib/usecases/document-navigation';
import { vrtAdapter } from '../lib/infrastructure/realtime/vrt-adapter';
import { proxyVoiceSession } from '../lib/infrastructure/realtime/voice-session-proxy';
import type { RealtimeConnection } from '../lib/usecases/ports';

// Real ClientSession + real app proxy. Only the socket and upstream HTTP
// service are simulated, including a distinct SDK transport session ID.
const sockets: Socket[] = [];
let serverSeq = 0;
let capabilities: string[] | undefined;
class Socket extends EventTarget {
  readyState = 1;
  binaryType = 'arraybuffer';
  sent: ClientMessage[] = [];
  constructor(readonly url: string) {
    super(); sockets.push(this);
    queueMicrotask(() => this.dispatchEvent(new Event('open')));
  }
  send(data: string) {
    const message = JSON.parse(data) as ClientMessage;
    this.sent.push(message);
    if (message.type === 'hello') queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({
      v: 1, seq: 0, type: 'ready', sessionId: 'sdk-transport-1',
      input: { encoding: 'pcm16', sampleRate: 24000 }, output: { encoding: 'pcm16', sampleRate: 24000 },
      ...(capabilities ? { capabilities } : {}),
      ...(sockets.length > 1 ? { resumedFrom: 0 } : {}),
    }) })));
  }
  receive(message: Unsequenced<ServerMessage>, seq = ++serverSeq) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ v: 1, seq, ...message }) }));
  }
  close(code = 1000, reason = '') {
    this.readyState = 3;
    this.dispatchEvent(new CloseEvent('close', { code, reason }));
  }
}
let transportId = 'doc-1';
let connection: RealtimeConnection;
let upstream: ReturnType<typeof vi.fn>;
const context = { documentId: 'doc-1', title: 'Project plan', language: 'en-US', vocabulary: ['VDoc'] };
beforeEach(() => {
  sockets.length = 0; transportId = 'doc-1'; serverSeq = 0;
  capabilities = ['tool-stream-v1', 'global-tool-ids-v1'];
  vi.stubGlobal('WebSocket', Socket);
  upstream = vi.fn(async (url: string, init: RequestInit) => {
    if (init.method === 'DELETE') return new Response(null, { status: 204 });
    if (url.endsWith('/grants')) return Response.json({ token: 'renewed-grant', expiresAt: Date.now() + 60000 });
    return Response.json({ documentId: transportId, sessionId: 'voice-1', realtimePath: `/v1/documents/${transportId}/voice-sessions/voice-1/realtime`, grant: { token: 'initial-grant', expiresAt: Date.now() + 60000 } });
  });
  vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit) => {
    const route = new URL(url).pathname;
    const action = init.method === 'DELETE' ? 'end' : route.endsWith('/grants') ? 'grant' : 'create';
    // The browser AbortSignal does not cross the HTTP boundary into a Worker.
    const { signal: _signal, ...wireInit } = init;
    const request = new Request(url, { ...wireInit, headers: { ...init.headers, Origin: location.origin } });
    return proxyVoiceSession(request, action, action === 'create' ? undefined : route.split('/')[3], {
      getUser: async () => ({ userId: 'user-1' }), serverUrl: 'https://voice.example', clientKey: 'server-only-client-key-24-characters',
      authorizeDocument: async () => transportId, fetch: upstream,
    });
  }));
});
afterEach(() => { connection?.close(); vi.unstubAllGlobals(); });

it.each(['doc-1', 'u_owner_scoped_document'])('authenticates the real SDK, reconnects and closes with transport document %s', async id => {
  transportId = id;
  const onStatus = vi.fn();
  connection = vrtAdapter.open({ config: { url: 'wss://voice.example', sessionsUrl: '/api/voice-sessions' }, context, tools: {}, signal: new AbortController().signal, onStatus });
  await vi.waitFor(() => expect(onStatus).toHaveBeenCalledWith('connected'));
  expect(sockets[0].url).toBe(`wss://voice.example/v1/documents/${transportId}/voice-sessions/voice-1/realtime`);
  expect(sockets[0].sent[0]).toMatchObject({ type: 'hello', auth: 'initial-grant', context: { ...context, documentId: transportId } });
  expect(upstream).toHaveBeenCalledTimes(1);
  sockets[0].close(1006, 'temporary disconnect');
  await vi.waitFor(() => expect(onStatus.mock.calls.filter(([status]) => status === 'connected')).toHaveLength(2));
  expect(sockets[1].url).toBe(sockets[0].url);
  expect(sockets[1].sent[0]).toMatchObject({ type: 'hello', auth: 'renewed-grant', sessionId: 'sdk-transport-1' });
  expect(upstream).toHaveBeenLastCalledWith(`https://voice.example/v1/documents/${transportId}/voice-sessions/voice-1/grants`, expect.any(Object));
  expect(upstream.mock.calls.filter(([, init]) => init.method === 'DELETE')).toHaveLength(0);
  connection.close();
  await vi.waitFor(() => expect(upstream).toHaveBeenLastCalledWith(`https://voice.example/v1/documents/${transportId}/voice-sessions/voice-1`, expect.objectContaining({ method: 'DELETE' })));
  expect(upstream).toHaveBeenCalledTimes(3);
  const upstreamHeaders = upstream.mock.calls.map(([, init]) => new Headers(init.headers));
  expect(upstreamHeaders.map(headers => headers.get('x-vdoc-user-id'))).toEqual(['user-1', 'user-1', 'user-1']);
  expect(new Set(upstreamHeaders.map(headers => headers.get('x-request-id'))).size).toBe(3);
  const browserMessages = JSON.stringify(sockets.flatMap(socket => socket.sent));
  expect(browserMessages).not.toContain('server-only-client-key');
  expect(browserMessages).not.toContain('documentSessionId');
});

// Exercise the real SDK against the real document executor, not a mocked run().
let editor: Editor | undefined, engine: DocumentEngine | undefined;
afterEach(() => { engine?.destroy(); editor?.destroy(); engine = undefined; editor = undefined; });
async function openEditor() {
  editor = new Editor({ extensions: createExtensions(), content: '<p>hello</p>' });
  await new Promise(resolve => setTimeout(resolve, 0));
  engine = new DocumentEngine(editor);
  const onStatus = vi.fn();
  connection = openDocumentRealtime({ engine, docId: 'doc-1', config: { url: 'wss://voice.example', sessionsUrl: '/api/voice-sessions' }, onStatus });
  await vi.waitFor(() => expect(onStatus).toHaveBeenCalledWith('connected'));
  return { editor, engine, onStatus };
}
function edit(text = '中文修改') {
  const snapshot = engine!.snapshot();
  return { expectedSessionId: snapshot.sessionId, expectedRevision: snapshot.revision,
    target: { kind: 'text', blockId: snapshot.blocks[0].id, start: 0, end: snapshot.blocks[0].text.length },
    operations: [{ type: 'text.replace', text }] };
}
const call = (callId: string, args: unknown, epoch = 1): Unsequenced<ServerMessage> => ({
  type: 'tool.call', callId, name: 'apply_document_operations', arguments: args, turnId: `turn-${epoch}`, epoch,
});
const results = (callId: string) => sockets.flatMap(socket => socket.sent).filter(message => message.type === 'tool.result' && message.callId === callId);

it.each([true, false])('commits only complete tool calls and deduplicates replay with negotiated streams=%s', async streams => {
  if (!streams) capabilities = undefined;
  const { engine, editor } = await openEditor();
  expect(sockets[0].sent[0]).toMatchObject({ type: 'hello', capabilities: expect.arrayContaining(['tool-stream-v1', 'global-tool-ids-v1']) });
  const args = edit();
  if (streams) {
    const stream = { type: 'tool.stream' as const, callId: 'edit-1', name: 'apply_document_operations', turnId: 'turn-1', epoch: 1 };
    sockets[0].receive({ ...stream, phase: 'start' });
    sockets[0].receive({ ...stream, phase: 'arguments-delta', delta: JSON.stringify(args) });
    sockets[0].receive({ ...stream, phase: 'arguments-complete', arguments: args });
    await Promise.resolve();
    expect(engine.records).toHaveLength(0);
    expect(editor.getText()).toBe('hello');
  }
  sockets[0].receive(call('edit-1', args));
  await vi.waitFor(() => expect(results('edit-1')).toHaveLength(1));
  expect(results('edit-1')[0]).toMatchObject({ ok: true });
  expect(editor.getText()).toBe('中文修改');
  const revision = engine.revision;
  // Wire sequence replay is dropped; a new envelope with the same call ID
  // is also safe because the document executor retains its committed result.
  sockets[0].receive(call('edit-1', args), serverSeq);
  sockets[0].receive(call('edit-1', args));
  await vi.waitFor(() => expect(results('edit-1')).toHaveLength(2));
  expect(engine.revision).toBe(revision);
  expect(engine.records).toHaveLength(1);
});

it('retains document call IDs across SDK resume and can undo the original turn', async () => {
  const { engine, editor, onStatus } = await openEditor();
  const args = edit();
  sockets[0].receive(call('edit-1', args));
  await vi.waitFor(() => expect(results('edit-1')).toHaveLength(1));
  const turnId = engine.records[0].turnId;
  sockets[0].close(1006, 'temporary disconnect');
  await vi.waitFor(() => expect(onStatus.mock.calls.filter(([status]) => status === 'connected')).toHaveLength(2));
  sockets[1].receive(call('edit-1', args));
  await vi.waitFor(() => expect(sockets[1].sent.some(message => message.type === 'tool.result' && message.callId === 'edit-1')).toBe(true));
  expect(engine.records).toHaveLength(1);
  sockets[1].receive({ type: 'tool.call', callId: 'undo-1', name: 'undo_turn', epoch: 2, turnId: 'turn-2',
    arguments: { targetTurnId: turnId, expectedSessionId: engine.sessionId, expectedRevision: engine.revision } });
  await vi.waitFor(() => expect(results('undo-1')).toHaveLength(1));
  expect(results('undo-1')[0]).toMatchObject({ ok: true });
  expect(editor.getText()).toBe('hello');
});

it.each(['local', 'server'] as const)('cancels a composition-waiting edit on %s interruption and rejects late old-epoch calls', async source => {
  const { engine, editor } = await openEditor();
  let composing = true;
  documentNavigation(editor).registerCompositionGuard(() => composing);
  const args = edit();
  sockets[0].receive(call('pending', args));
  await Promise.resolve();
  expect(engine.records).toHaveLength(0);
  if (source === 'local') connection.interrupt('keyboard');
  else sockets[0].receive({ type: 'interrupted', epoch: 1 });
  sockets[0].receive(call('late', args));
  await vi.waitFor(() => expect(results('pending')).toHaveLength(1));
  expect(results('pending')[0]).toMatchObject({ ok: false, code: 'INTERRUPTED' });
  expect(results('late')[0]).toMatchObject({ ok: false, code: 'INTERRUPTED' });
  composing = false;
  sockets[0].receive(call('next', edit('下一轮'), 2));
  await vi.waitFor(() => expect(results('next')).toHaveLength(1));
  expect(results('next')[0]).toMatchObject({ ok: true });
  expect(editor.getText()).toBe('下一轮');
  expect(engine.records).toHaveLength(1);
});

it('reports invalid and stale document edits as failed tool results without ending the connection', async () => {
  const { engine, editor, onStatus } = await openEditor();
  sockets[0].receive(call('invalid', {}));
  sockets[0].receive(call('stale', { ...edit(), expectedRevision: engine.revision + 10 }));
  await vi.waitFor(() => expect(results('stale')).toHaveLength(1));
  expect(results('invalid')[0]).toMatchObject({ ok: false, code: 'FAILED', message: expect.stringContaining('INVALID') });
  expect(results('stale')[0]).toMatchObject({ ok: false, code: 'FAILED', message: expect.stringContaining('STALE') });
  expect(editor.getText()).toBe('hello');
  expect(upstream.mock.calls.some(([, init]) => init.method === 'DELETE')).toBe(false);
  expect(onStatus).not.toHaveBeenCalledWith('error', expect.anything());
});

it('keeps a recoverable model error connected so the next instruction can succeed', async () => {
  const { editor, onStatus } = await openEditor();
  sockets[0].receive({ type: 'error', code: 'AGENT_ERROR', message: 'private provider details', recoverable: true });
  connection.sendText('再试一次');
  expect(sockets[0].sent).toContainEqual(expect.objectContaining({ type: 'text', text: '再试一次' }));
  expect(upstream.mock.calls.some(([, init]) => init.method === 'DELETE')).toBe(false);
  expect(JSON.stringify(onStatus.mock.calls)).not.toContain('private provider details');
  sockets[0].receive(call('retry', edit()));
  await vi.waitFor(() => expect(results('retry')).toHaveLength(1));
  expect(editor.getText()).toBe('中文修改');
});
