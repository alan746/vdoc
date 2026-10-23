import { afterEach, beforeEach, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { createExtensions } from '../lib/editor/extensions';
import { DocumentEngine } from '../lib/usecases/engine';
import { openDocumentRealtime } from '../lib/composition/realtime';
import { createFakeVrtAdapter } from './support/fake-vrt-adapter';
import { replaceFirstBlockRequest, staleRevisionRequest, toolContext, undoTurnRequest } from './support/realtime-scenarios';

// Exercises the full composition stack (openDocumentRealtime + document tools
// + DocumentEngine) through the shared fake adapter, so the remaining vdoc#35
// work (context/readBlocks, preview, capability negotiation) can be developed
// and regression-tested without a running @vrealtime/client server.

let editor: Editor, engine: DocumentEngine;
let adapter: ReturnType<typeof createFakeVrtAdapter>;
const statuses: { status: string; message?: string }[] = [];
const open = (docId = 'doc') => openDocumentRealtime(
  { docId, engine, config: { url: 'ws://localhost:8790', tokenUrl: '/token' }, onStatus: (status, message) => statuses.push({ status, message }) },
  adapter.port,
);
beforeEach(async () => {
  editor = new Editor({ extensions: createExtensions(), content: '<p>hello</p><p>second</p>' });
  await new Promise(resolve => setTimeout(resolve, 0));
  engine = new DocumentEngine(editor); adapter = createFakeVrtAdapter(); statuses.length = 0;
});
afterEach(() => { engine.destroy(); editor.destroy(); });

it('connects, applies an operation, and reports affected state through read_document', async () => {
  const connection = open();
  expect(statuses).toEqual([{ status: 'connecting' }, { status: 'connected' }]);
  const session = adapter.sessions[0];
  const result = await session.call('apply_document_operations', replaceFirstBlockRequest(engine, 'AI'), toolContext());
  expect(result).toMatchObject({ ok: true });
  expect(engine.snapshot().blocks[0].text).toBe('AI');
  expect(session.call('read_document', {}, toolContext({ callId: 'read' }))).toMatchObject({ agentEdits: [{ turnId: engine.records[0].turnId }] });
  connection.close();
});

it('vdoc#35: a manual edit that moves the revision makes a pinned-revision call stale', async () => {
  const connection = open(); const session = adapter.sessions[0];
  editor.commands.insertContent('!');
  const result = await session.call('apply_document_operations', staleRevisionRequest(engine, 'AI'), toolContext());
  expect(result).toMatchObject({ ok: false, code: 'STALE' });
  expect(engine.snapshot().blocks[0].text).not.toBe('AI');
  connection.close();
});

it('vdoc#35: undoing a turn keeps an unrelated manual edit made afterwards', async () => {
  const connection = open(); const session = adapter.sessions[0];
  await session.call('apply_document_operations', replaceFirstBlockRequest(engine, 'AI'), toolContext());
  const turnId = engine.records[0].turnId!;
  editor.commands.setTextSelection(engine.snapshot().blocks[1].from + 6); editor.commands.insertContent('!');
  const result = await session.call('undo_turn', undoTurnRequest(engine, turnId), toolContext({ callId: 'undo', turnId: 'undo-turn' }));
  expect(result).toMatchObject({ ok: true });
  expect(engine.snapshot().blocks.map(b => b.text)).toEqual(['hello', 'second!']);
  connection.close();
});

it('surfaces a server-initiated reconnect and disconnect without touching the document', async () => {
  const connection = open(); const session = adapter.sessions[0];
  session.reconnect(); session.disconnectFromServer();
  expect(statuses.map(s => s.status)).toEqual(['connecting', 'connected', 'reconnecting', 'connected', 'disconnected']);
  expect(engine.snapshot().blocks[0].text).toBe('hello');
  connection.close();
});

it('rejects calls that arrive after the connection has closed', async () => {
  const first = open('first'); const session = adapter.sessions[0];
  first.close();
  const result = await session.call('apply_document_operations', replaceFirstBlockRequest(engine, 'late'), toolContext());
  expect(result).toMatchObject({ code: 'INTERRUPTED' });
  expect(engine.snapshot().blocks[0].text).toBe('hello');
});
