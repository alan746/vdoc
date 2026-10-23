import { afterEach, beforeEach, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { createExtensions } from '../lib/editor/extensions';
import { DocumentEngine } from '../lib/usecases/engine';
import { createRealtimeExecutor, type RecentVoiceEdit } from '../lib/usecases/realtime-executor';
import type { RealtimeToolContext } from '../lib/usecases/ports';

// read()/readBlocks() return a failure shape on error; these helpers assert
// the call succeeded so tests can access the voice-context fields directly.
type ReadOk = { outline: { id: string; level: number; text: string }[]; selection: { from: number; to: number }; recentEdits: RecentVoiceEdit[] };
type ReadBlocksOk = { docId: string; sessionId: string; blocks: { id: string; type: string; text: string }[] };
function ok<T>(result: T | { ok: false }): T { expect((result as { ok?: boolean }).ok).not.toBe(false); return result as T; }

// Covers vdoc#35 task 1 (context, on-demand reads): outline, a selection
// frozen for the lifetime of a voice turn, and recent agent edits whose
// affected block IDs are re-checked against the live document.

let editor: Editor, engine: DocumentEngine, lifetime: AbortController;
let executor: ReturnType<typeof createRealtimeExecutor>;
const context = (callId = 'call-1', turnId = 'turn-1'): RealtimeToolContext => ({ callId, turnId, epoch: 1, signal: new AbortController().signal });
const request = (text = 'AI') => {
  const s = engine.snapshot();
  return { expectedSessionId: s.sessionId, expectedRevision: s.revision, target: { kind: 'block' as const, id: s.blocks[0].id }, operations: [{ type: 'text.replace' as const, text }] };
};
beforeEach(async () => {
  editor = new Editor({ extensions: createExtensions(), content: '<h1>Title</h1><p>hello</p><p>second</p><h2>Sub</h2>' });
  await new Promise(resolve => setTimeout(resolve, 0));
  engine = new DocumentEngine(editor); lifetime = new AbortController();
  executor = createRealtimeExecutor(engine, { docId: 'doc-1', actor: 'trusted-agent', signal: lifetime.signal, currentDocument: () => ({ docId: 'doc-1', sessionId: engine.sessionId }) });
});
afterEach(() => { lifetime.abort(); engine.destroy(); editor.destroy(); });

it('lists headings in document order with their stable block IDs', () => {
  const outline = ok<ReadOk>(executor.read(context())).outline;
  expect(outline).toEqual([
    { id: engine.snapshot().blocks[0].id, level: 1, text: 'Title' },
    { id: engine.snapshot().blocks[3].id, level: 2, text: 'Sub' },
  ]);
});

it('freezes the selection a voice turn saw on its first read, then refreshes on the next turn', () => {
  editor.commands.setTextSelection(3);
  const first = ok<ReadOk>(executor.read(context('r1', 'turn-A'))).selection;
  editor.commands.setTextSelection(10);
  expect(ok<ReadOk>(executor.read(context('r2', 'turn-A'))).selection).toEqual(first);
  expect(ok<ReadOk>(executor.read(context('r3', 'turn-B'))).selection).not.toEqual(first);
});

it('reports recent agent edits and drops block IDs that no longer exist', async () => {
  await executor.apply(request(), context('call-1', 'turn-1'));
  const first = ok<ReadOk>(executor.read(context('read-1'))).recentEdits;
  expect(first).toHaveLength(1);
  expect(first[0]).toMatchObject({ turnId: 'turn-1', actor: 'trusted-agent' });
  expect(first[0].affectedBlockIds.length).toBeGreaterThan(0);
  editor.commands.setContent('<p>replaced entirely</p>');
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(ok<ReadOk>(executor.read(context('read-2'))).recentEdits[0].affectedBlockIds).toEqual([]);
});

it('does not report user-sourced edits as recent agent edits', () => {
  editor.commands.insertContent('typed');
  expect(ok<ReadOk>(executor.read(context())).recentEdits).toEqual([]);
});

it('reads full content for specific block IDs and omits unknown ones', () => {
  const id = engine.snapshot().blocks[2].id;
  const result = ok<ReadBlocksOk>(executor.readBlocks({ ids: [id, 'missing-id'] }, context()));
  expect(result).toMatchObject({ docId: 'doc-1', sessionId: engine.sessionId });
  expect(result.blocks).toHaveLength(1);
  expect(result.blocks[0]).toMatchObject({ id, type: 'paragraph', text: 'second' });
});

it('rejects an empty or oversized read_blocks request', () => {
  expect(executor.readBlocks({ ids: [] }, context())).toMatchObject({ code: 'INVALID' });
  expect(executor.readBlocks({ ids: Array.from({ length: 201 }, (_, i) => `id-${i}`) }, context())).toMatchObject({ code: 'INVALID' });
});

it('gates read_blocks through the same checks as apply/undo', () => {
  const cancelled = new AbortController(); cancelled.abort();
  expect(executor.readBlocks({ ids: ['x'] }, { ...context(), signal: cancelled.signal })).toMatchObject({ code: 'INTERRUPTED' });
  lifetime.abort();
  expect(executor.readBlocks({ ids: ['x'] }, context())).toMatchObject({ code: 'INTERRUPTED' });
});
