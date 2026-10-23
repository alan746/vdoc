import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import type { ClientMessage } from '@vrealtime/protocol';
import { createExtensions } from '../lib/editor/extensions';
import { DocumentEngine } from '../lib/usecases/engine';
import { openDocumentRealtime } from '../lib/composition/realtime';
import type { RealtimeActivity, RealtimeConnection } from '../lib/usecases/ports';

// Use the installed ClientSession and its real ToolHost. Only the transport
// and auth endpoint are faked, so these assertions cover the actual wire
// result and activity event, not a reimplementation of SDK error handling.
const sockets: FakeSocket[] = [];
class FakeSocket extends EventTarget {
  readyState = 1;
  binaryType = 'arraybuffer';
  sent: ClientMessage[] = [];
  private sequence = 0;
  constructor(_url: string) {
    super(); sockets.push(this);
    queueMicrotask(() => this.dispatchEvent(new Event('open')));
  }
  send(data: string) {
    const message = JSON.parse(data) as ClientMessage;
    this.sent.push(message);
    if (message.type === 'hello') queueMicrotask(() => this.receive({
      type: 'ready', sessionId: 'voice-session',
      input: { encoding: 'pcm16', sampleRate: 24000 }, output: { encoding: 'pcm16', sampleRate: 24000 },
    }));
  }
  receive(message: { type: string; [key: string]: unknown }) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ v: 1, seq: message.type === 'ready' ? 0 : ++this.sequence, ...message }) }));
  }
  close(code = 1000, reason = '') {
    this.readyState = 3;
    this.dispatchEvent(new CloseEvent('close', { code, reason }));
  }
}

let editor: Editor, engine: DocumentEngine, connection: RealtimeConnection;
const activities: RealtimeActivity[] = [];
beforeEach(async () => {
  sockets.length = 0;
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ token: 'test-grant' }) })));
  editor = new Editor({ extensions: createExtensions(), content: '<p>hello</p><p>second</p>' });
  await new Promise(resolve => setTimeout(resolve, 0));
  engine = new DocumentEngine(editor); activities.length = 0;
  const onStatus = vi.fn();
  connection = openDocumentRealtime({ engine, docId: 'doc', config: { url: 'ws://localhost:8790', tokenUrl: '/token' }, onStatus, onActivity: event => activities.push(event) });
  await vi.waitFor(() => expect(onStatus).toHaveBeenCalledWith('connected'));
});
afterEach(() => { connection?.close(); engine?.destroy(); editor?.destroy(); vi.unstubAllGlobals(); });

const request = (operations: unknown[]) => ({
  expectedSessionId: engine.sessionId, expectedRevision: engine.revision,
  target: { kind: 'block', id: engine.snapshot().blocks[0].id }, operations,
});
type WireResult = Extract<ClientMessage, { type: 'tool.result' }>;
async function call(name: string, args: unknown, callId = 'call-1') {
  const socket = sockets[0];
  const start = socket.sent.length;
  socket.receive({ type: 'tool.call', name, arguments: args, callId, turnId: 'turn-1', epoch: 1 });
  let result: WireResult | undefined;
  await vi.waitFor(() => {
    result = socket.sent.slice(start).find((message): message is WireResult => message.type === 'tool.result' && message.callId === callId);
    expect(result).toBeDefined();
  });
  return result!;
}

it('sends a failed deletion as ok:false with the field path, and marks UI activity as failed', async () => {
  const before = editor.getJSON(), revision = engine.revision;
  const result = await call('apply_document_operations', request([{ type: 'block.delete' }]));
  expect(result).toMatchObject({ ok: false, code: 'FAILED', message: expect.stringContaining('INVALID: operations[0].id: Required') });
  expect(result).toMatchObject({ message: expect.stringContaining('This call did NOT apply an edit.') });
  expect(result).not.toHaveProperty('output');
  expect(activities).toContainEqual({ type: 'result', callId: 'call-1', ok: false });
  expect(editor.getJSON()).toEqual(before); expect(engine.revision).toBe(revision);
});

it('preserves successful SDK outputs and replay, but reports changed arguments as failed', async () => {
  const input = request([{ type: 'block.delete', id: engine.snapshot().blocks[0].id }]);
  const result = await call('apply_document_operations', input);
  expect(result).toMatchObject({ ok: true, output: { ok: true } });
  const revision = engine.revision;
  const replay = await call('apply_document_operations', input);
  if (!result.ok) throw new Error('Expected the initial deletion to succeed.');
  expect(replay).toMatchObject({ ok: true, output: result.output });
  expect(engine.revision).toBe(revision); expect(engine.records).toHaveLength(1);
  expect(engine.snapshot().blocks.map(block => block.text)).toEqual(['second']);
  expect(await call('apply_document_operations', request([{ type: 'text.replace', text: 'changed' }]))).toMatchObject({
    ok: false, code: 'FAILED', message: expect.stringContaining('DUPLICATE:'),
  });
  expect(engine.revision).toBe(revision);
});

it('routes synchronous read validation errors through the same SDK failure channel', async () => {
  expect(await call('read_blocks', { ids: [] })).toMatchObject({
    ok: false, code: 'FAILED', message: expect.stringContaining('INVALID: ids:'),
  });
  expect(activities).toContainEqual({ type: 'result', callId: 'call-1', ok: false });
});
