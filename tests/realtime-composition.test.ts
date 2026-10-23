import { afterEach, beforeEach, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { createExtensions } from '../lib/editor/extensions';
import { DocumentEngine } from '../lib/usecases/engine';
import { openDocumentRealtime } from '../lib/composition/realtime';
import type { RealtimePort, RealtimeToolContext } from '../lib/usecases/ports';
let editor: Editor, engine: DocumentEngine;
let sessions: Parameters<RealtimePort['open']>[0][];
const port: RealtimePort = { open(options) { sessions.push(options); return { interrupt() {}, sendText() {}, close() {} }; } };
const open = (docId = 'doc') => openDocumentRealtime({ docId, engine, config: { url: 'ws://localhost:8790', tokenUrl: '/token' }, onStatus() {} }, port);
const ctx: RealtimeToolContext = { callId: 'call-1', turnId: 'turn-1', epoch: 1, signal: new AbortController().signal };
const args = (text: string) => ({ expectedSessionId: engine.sessionId, expectedRevision: engine.revision, target: { kind: 'block', id: engine.snapshot().blocks[0].id }, operations: [{ type: 'text.replace', text }] });
beforeEach(async () => {
  sessions = []; editor = new Editor({ extensions: createExtensions(), content: '<p>hello</p>' });
  await new Promise(resolve => setTimeout(resolve, 0)); engine = new DocumentEngine(editor);
});
afterEach(() => { engine.destroy(); editor.destroy(); });
it('does not merge reused server turn IDs across fresh connections', async () => {
  const first = open(); await sessions[0].tools.apply_document_operations.run(args('first'), ctx);
  const firstTurn = engine.records[0].turnId; first.close();
  const second = open(); await sessions[1].tools.apply_document_operations.run(args('second'), ctx);
  const secondTurn = engine.records[0].turnId; expect(secondTurn).not.toBe(firstTurn);
  expect(await sessions[1].tools.undo_turn.run({ targetTurnId: secondTurn, expectedSessionId: engine.sessionId, expectedRevision: engine.revision }, { ...ctx, callId: 'undo', turnId: 'undo' })).toMatchObject({ ok: true });
  expect(engine.snapshot().blocks[0].text).toBe('first'); second.close();
});
it('keeps the same IDs on SDK replay and exposes them for undo', async () => {
  const connection = open(); const input = args('first');
  const first = await sessions[0].tools.apply_document_operations.run(input, ctx);
  expect(await sessions[0].tools.apply_document_operations.run(input, ctx)).toEqual(first);
  expect(engine.records).toHaveLength(1);
  expect(sessions[0].tools.read_document.run({}, { ...ctx, callId: 'read' })).toMatchObject({ agentEdits: [{ turnId: engine.records[0].turnId }] }); connection.close();
});
it('rejects calls retained by an old connection after a document switch', async () => {
  const first = open('first'); const input = args('late'); first.close(); const next = open('next');
  expect(sessions[0].signal.aborted).toBe(true);
  expect(await sessions[0].tools.apply_document_operations.run(input, ctx)).toMatchObject({ code: 'INTERRUPTED' });
  expect(engine.snapshot().blocks[0].text).toBe('hello'); next.close();
});
