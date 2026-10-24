import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import type { ClientMessage } from '@vrealtime/protocol';
import { attachStreamingDraft } from '../lib/editor/realtime/streaming-draft';
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
      capabilities: ['tool-stream-v1'],
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

let editor: Editor, engine: DocumentEngine, connection: RealtimeConnection, draft: ReturnType<typeof attachStreamingDraft>;
const activities: RealtimeActivity[] = [];
beforeEach(async () => {
  sockets.length = 0;
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => init.method === 'DELETE' ? { ok: true } : ({
    ok: true, json: async () => ({ documentId: 'doc', sessionId: 'voice-session',
      realtimePath: '/v1/documents/doc/voice-sessions/voice-session/realtime',
      grant: { token: 'test-grant', expiresAt: Date.now() + 60000 } }),
  })));
  editor = new Editor({ extensions: createExtensions(), content: '<p>hello</p><p>second</p>' });
  await new Promise(resolve => setTimeout(resolve, 0));
  engine = new DocumentEngine(editor); draft = attachStreamingDraft(editor); activities.length = 0;
  const onStatus = vi.fn();
  connection = openDocumentRealtime({ engine, docId: 'doc', config: { url: 'ws://localhost:8790', sessionsUrl: '/api/voice-sessions' }, onStatus, onActivity: event => { activities.push(event); draft.receive(event); } });
  await vi.waitFor(() => expect(onStatus).toHaveBeenCalledWith('connected'));
});
afterEach(() => { connection?.close(); draft?.dispose(); engine?.destroy(); editor?.destroy(); vi.unstubAllGlobals(); });

it('carries real SDK text and argument streams to the UI without executing incomplete writes', () => {
  const socket = sockets[0], before = editor.getJSON();
  socket.receive({ type: 'text', responseId: 'worker', delta: '正在写入' });
  const stream = { type: 'tool.stream', callId: 'stream-write', name: 'insert_structured_article', turnId: 'turn-1', epoch: 1 };
  socket.receive({ ...stream, phase: 'start' });
  socket.receive({ ...stream, phase: 'arguments-delta', delta: '{"blocks":[{"kind":"paragraph","text":"逐步' });
  expect(activities).toContainEqual({ type: 'text', responseId: 'worker', delta: '正在写入' });
  expect(activities).toContainEqual({ type: 'preview', callId: 'stream-write', phase: 'streaming', text: '逐步' });
  expect(editor.getJSON()).toEqual(before);
  connection.interrupt();
  expect(activities).toContainEqual({ type: 'preview', callId: 'stream-write', phase: 'cancelled', text: '逐步' });
  socket.receive({ ...stream, phase: 'arguments-delta', delta: '迟到内容' });
  expect(JSON.stringify(activities)).not.toContain('迟到内容');
  expect(editor.getJSON()).toEqual(before);
});

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
  expect(activities).toContainEqual(expect.objectContaining({ type: 'result', callId: 'call-1', ok: false, code: 'FAILED' }));
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
  expect(activities).toContainEqual(expect.objectContaining({ type: 'result', callId: 'call-1', ok: false, code: 'FAILED' }));
});

it('appends a three-row two-column table through the real SDK and document engine', async () => {
  const result = await call('apply_document_operations', request([
    { type: 'block.insert', beforeId: null, block: { kind: 'table', rows: 3, cols: 2, header: true } },
  ]));
  expect(result).toMatchObject({ ok: true, output: { ok: true } });
  const content = editor.getJSON().content!;
  expect(content.slice(0, 2)).toMatchObject([{ content: [{ text: 'hello' }] }, { content: [{ text: 'second' }] }]);
  const table = content[2];
  expect(table.type).toBe('table');
  expect(table.content).toHaveLength(3);
  for (const row of table.content!) {
    expect(row.type).toBe('tableRow');
    expect('content' in row && row.content).toHaveLength(2);
  }
});

it('rejects invalid table dimensions without an edit and lets a corrected call succeed', async () => {
  const before = editor.getJSON();
  const failed = await call('apply_document_operations', request([{ type: 'table.insert', rows: 'three', cols: 2 }]));
  expect(failed).toMatchObject({ ok: false, code: 'FAILED', message: expect.stringContaining('INVALID: operations[0].rows:') });
  expect(editor.getJSON()).toEqual(before);
  expect(await call('apply_document_operations', request([{ type: 'table.insert', rows: 3, cols: 2 }]), 'corrected-call'))
    .toMatchObject({ ok: true, output: { ok: true } });
  expect(editor.getJSON().content!.some(node => node.type === 'table')).toBe(true);
});

it('renders successive wire chunks in the document before execution, then commits once without duplicate text', async () => {
  const socket = sockets[0], before = editor.getJSON(), revision = engine.revision;
  const args = request([{ type: 'block.insert', beforeId: null, block: { kind: 'paragraph', text: '逐步生成正文<script>纯文本</script>' } }]);
  const stream = { type: 'tool.stream', callId: 'write-draft', name: 'apply_document_operations', epoch: 1, turnId: 'turn-1' };
  const json = JSON.stringify(args), split = json.indexOf('生成');
  socket.receive({ ...stream, phase: 'start' });
  socket.receive({ ...stream, phase: 'arguments-delta', delta: json.slice(0, split) });
  expect(editor.view.dom.querySelector('.vdoc-streaming-draft')?.textContent).toBe('逐步');
  expect(editor.getJSON()).toEqual(before); expect(engine.revision).toBe(revision);
  socket.receive({ ...stream, phase: 'arguments-delta', delta: json.slice(split) });
  expect(editor.view.dom.querySelector('.vdoc-streaming-draft')?.textContent).toBe('逐步生成正文<script>纯文本</script>');
  expect(editor.view.dom.querySelector('script')).toBeNull();
  expect(editor.getJSON()).toEqual(before);
  expect(await call('apply_document_operations', args, 'write-draft')).toMatchObject({ ok: true });
  expect(editor.view.dom.querySelector('.vdoc-streaming-draft')).toBeNull();
  expect(engine.snapshot().blocks.map(block => block.text)).toEqual(['hello', 'second', '逐步生成正文<script>纯文本</script>']);
  expect(engine.records).toHaveLength(1);
});
it.each(['interruption', 'failure', 'concurrent edit'])('removes streamed document text after %s and ignores later chunks', async mode => {
  const socket = sockets[0], before = editor.getJSON();
  const stream = { type: 'tool.stream', callId: 'unfinished', name: 'apply_document_operations', epoch: 1, turnId: 'turn-1' };
  socket.receive({ ...stream, phase: 'arguments-delta', delta: '{"operations":[{"type":"block.insert","beforeId":null,"block":{"kind":"paragraph","text":"未完成' });
  expect(editor.view.dom.querySelector('.vdoc-streaming-draft')?.textContent).toBe('未完成');
  if (mode === 'interruption') connection.interrupt();
  else if (mode === 'failure') await call('apply_document_operations', request([{ type: 'block.insert' }]), 'unfinished');
  else editor.commands.insertContentAt(1, '用户文字');
  expect(editor.view.dom.querySelector('.vdoc-streaming-draft')).toBeNull();
  socket.receive({ ...stream, phase: 'arguments-delta', delta: '不应再出现"}}]}' });
  expect(editor.view.dom.querySelector('.vdoc-streaming-draft')).toBeNull();
  if (mode !== 'concurrent edit') expect(editor.getJSON()).toEqual(before);
});
