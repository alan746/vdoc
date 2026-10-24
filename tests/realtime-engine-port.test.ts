import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRealtimeExecutor, type RealtimeEngine } from '../lib/usecases/realtime-executor';
import type { AppliedChange, OperationResult } from '../lib/domain/entities/operation';
import type { RealtimeToolContext } from '../lib/usecases/ports';

// vdoc#43: the executor depends on RealtimeEngine only. These tests drive it
// with a plain object - no Tiptap editor, no DocumentEngine - to prove the
// protocol logic (binding, dedup, composition wait, results) is decoupled.

let engine: RealtimeEngine & { composing: boolean; editable: boolean; emit(event: AppliedChange): void };
let lifetime: AbortController;
const context = (callId = 'call-1', turnId = 'turn-1'): RealtimeToolContext => ({ callId, turnId, epoch: 1, signal: new AbortController().signal });
const request = { expectedSessionId: 'session', expectedRevision: 3, target: { kind: 'block', id: 'b1' }, operations: [{ type: 'text.replace', text: 'AI' }] };
beforeEach(() => {
  const listeners = new Set<(event: AppliedChange) => void>();
  engine = {
    sessionId: 'session', revision: 3, records: [], composing: false, editable: true,
    canEdit: () => engine.editable,
    isComposing: () => engine.composing,
    insertStructuredArticle: vi.fn(() => ({ ok: true, id: 'article', revision: 4 })),
    executeAgent: vi.fn((input: { id: string }, origin): OperationResult => {
      engine.emit({ id: input.id, label: 'Replace text', source: 'agent', ...origin, revision: 4, changedBlockIds: ['b1'], documentChanged: true });
      return { ok: true, id: input.id, revision: 4 };
    }) as RealtimeEngine['executeAgent'],
    undoTurn: vi.fn((): OperationResult => ({ ok: true, id: 'undo-op', revision: 5 })),
    snapshot: vi.fn() as unknown as RealtimeEngine['snapshot'],
    outline: () => [{ id: 'h1', level: 1, text: 'Title' }],
    selectionContext: () => ({ selectionPath: [], selectedTopLevelBlockIds: ['b1'], selectionTruncated: false, focus: null, previous: null, next: null, heading: null }),
    readBlocks: () => ({ blocks: [], tables: [] }),
    hasBlock: id => id === 'b1',
    anchorSelection: () => ({ resolve: () => ({ from: 2, to: 4 }), release: vi.fn() }),
    onApplied: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    emit: event => { for (const listener of listeners) listener(event); },
  };
  lifetime = new AbortController();
});
afterEach(() => { lifetime.abort(); vi.useRealTimers(); });
const executor = () => createRealtimeExecutor(engine, { docId: 'doc', actor: 'agent', signal: lifetime.signal, currentDocument: () => ({ docId: 'doc', sessionId: 'session' }), compositionTimeoutMs: 100 });

it('commits through executeAgent with trusted identity and reports affected blocks', async () => {
  const run = executor();
  expect(await run.apply(request, context())).toEqual({ ok: true, id: 'call-1', revision: 4, affectedBlockIds: ['b1'] });
  expect(engine.executeAgent).toHaveBeenCalledWith({ ...request, id: 'call-1' }, { actor: 'agent', turnId: 'turn-1' });
});

it('deduplicates by call ID without calling the engine twice', async () => {
  const run = executor();
  const first = await run.apply(request, context());
  expect(await run.apply(request, context())).toEqual(first);
  expect(engine.executeAgent).toHaveBeenCalledTimes(1);
});

it('waits for composition through isComposing(), then commits once', async () => {
  vi.useFakeTimers(); engine.composing = true;
  const pending = executor().apply(request, context());
  expect(engine.executeAgent).not.toHaveBeenCalled();
  engine.composing = false; await vi.advanceTimersByTimeAsync(20);
  expect(await pending).toMatchObject({ ok: true });
  expect(engine.executeAgent).toHaveBeenCalledTimes(1);
});

it('refuses calls when canEdit() is false', async () => {
  engine.editable = false;
  expect(await executor().apply(request, context())).toMatchObject({ code: 'UNAVAILABLE' });
  expect(engine.executeAgent).not.toHaveBeenCalled();
});

it('builds get_context from outline, anchors and hasBlock alone', async () => {
  const run = executor();
  await run.apply(request, context());
  expect(run.getContext(context('read', 'turn-2'))).toEqual({
    docId: 'doc', sessionId: 'session', revision: 3, selection: { from: 2, to: 4 },
    outline: [{ id: 'h1', level: 1, text: 'Title' }],
    blockContext: { selectionPath: [], selectedTopLevelBlockIds: ['b1'], selectionTruncated: false, focus: null, previous: null, next: null, heading: null },
    recentEdits: [{ id: 'call-1', turnId: 'turn-1', actor: 'agent', revision: 4, affectedBlockIds: ['b1'] }],
  });
});
