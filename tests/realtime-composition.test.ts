import { afterEach, beforeEach, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { createExtensions } from '../lib/editor/extensions';
import { DocumentEngine } from '../lib/usecases/engine';
import { openDocumentRealtime } from '../lib/composition/realtime';
import type { RealtimePort, RealtimeToolContext } from '../lib/usecases/ports';
let editor: Editor, engine: DocumentEngine;
let sessions: Parameters<RealtimePort['open']>[0][];
const port: RealtimePort = { open(options) { sessions.push(options); return { interrupt() {}, sendText() {}, close() {} }; } };
const open = (docId = 'doc') => openDocumentRealtime({ docId, engine, config: { url: 'ws://localhost:8790', sessionsUrl: '/api/voice-sessions' }, onStatus() {} }, port);
const ctx: RealtimeToolContext = { callId: 'call-1', turnId: 'turn-1', epoch: 1, signal: new AbortController().signal };
const args = (text: string) => ({ expectedSessionId: engine.sessionId, expectedRevision: engine.revision, target: { kind: 'block', id: engine.snapshot().blocks[0].id }, operations: [{ type: 'text.replace', text }] });
beforeEach(async () => {
  sessions = []; editor = new Editor({ extensions: createExtensions(), content: '<p>hello</p>' });
  await new Promise(resolve => setTimeout(resolve, 0)); engine = new DocumentEngine(editor);
});
afterEach(() => { engine.destroy(); editor.destroy(); });
it('sends the current title, document language and vocabulary without the editing session ID', () => {
  editor.commands.command(({ tr }) => { tr.setDocAttribute('language', 'fr-CA'); return true; });
  const connection = openDocumentRealtime({ engine, docId: 'doc', title: 'Current title', config: { url: 'ws://localhost:8790', sessionsUrl: '/api/voice-sessions', vocabulary: ['VDoc'] }, onStatus() {} }, port);
  expect(sessions[0].context).toEqual({ documentId: 'doc', title: 'Current title', language: 'fr-CA', vocabulary: ['VDoc'] });
  expect(sessions[0]).not.toHaveProperty('sessionId');
  connection.close();
});
it('defaults an unspecified document language to English and accepts an explicit voice preference', () => {
  const first = open();
  expect(sessions[0].context.language).toBe('en-US'); first.close();
  const second = openDocumentRealtime({ engine, docId: 'doc', config: { url: 'ws://localhost:8790', sessionsUrl: '/api/voice-sessions', language: 'zh-CN' }, onStatus() {} }, port);
  expect(sessions[1].context.language).toBe('zh-CN'); second.close();
});
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
  await expect(sessions[0].tools.apply_document_operations.run(input, ctx)).rejects.toThrow('INTERRUPTED:');
  expect(engine.snapshot().blocks[0].text).toBe('hello'); next.close();
});
