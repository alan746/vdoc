import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { createExtensions } from '../lib/editor/extensions';
import { DocumentEngine } from '../lib/usecases/engine';
import { createRealtimeExecutor } from '../lib/usecases/realtime-executor';
import { documentNavigation } from '../lib/usecases/document-navigation';
import type { RealtimeToolContext } from '../lib/usecases/ports';

let editor: Editor, engine: DocumentEngine, lifetime: AbortController, call: AbortController;
let current: { docId: string; sessionId: string } | null, composing: boolean;
let executor: ReturnType<typeof createRealtimeExecutor>;
const context = (callId = 'call-1', turnId = 'turn-1'): RealtimeToolContext => ({ callId, turnId, epoch: 1, signal: call.signal });
const request = (text = 'AI') => {
  const s = engine.snapshot();
  return { expectedSessionId: s.sessionId, expectedRevision: s.revision,
    target: { kind: 'text', blockId: s.blocks[0].id, start: 0, end: s.blocks[0].text.length }, operations: [{ type: 'text.replace', text }] };
};
beforeEach(async () => {
  editor = new Editor({ extensions: createExtensions(), content: '<p>hello</p><p>second</p>' });
  await new Promise(resolve => setTimeout(resolve, 0));
  engine = new DocumentEngine(editor); lifetime = new AbortController(); call = new AbortController();
  current = { docId: 'doc-1', sessionId: engine.sessionId }; composing = false;
  documentNavigation(editor).registerCompositionGuard(() => composing);
  executor = createRealtimeExecutor(engine, { docId: 'doc-1', actor: 'trusted-agent', signal: lifetime.signal, currentDocument: () => current, compositionTimeoutMs: 100 });
});
afterEach(() => { lifetime.abort(); engine.destroy(); editor.destroy(); vi.useRealTimers(); });

it('uses trusted execution context and retains structured read/commit results', async () => {
  const userSelection = editor.state.selection.toJSON();
  expect(await executor.apply(request(), context())).toMatchObject({ ok: true, id: 'call-1' });
  expect(engine.records[0]).toMatchObject({ source: 'agent', actor: 'trusted-agent', turnId: 'turn-1' });
  expect(editor.state.selection.toJSON()).toEqual(userSelection);
  expect(executor.read(context('read'))).toMatchObject({ docId: 'doc-1', agentEdits: [{ turnId: 'turn-1' }] });
});
it('vdoc#35 task 4: a successful commit reports the blocks it actually changed', async () => {
  const applied = await executor.apply(request(), context());
  expect(applied).toMatchObject({ ok: true, affectedBlockIds: [engine.snapshot().blocks[0].id] });
  const args = { targetTurnId: 'turn-1', expectedSessionId: engine.sessionId, expectedRevision: engine.revision };
  const undone = await executor.undo(args, context('undo-1', 'undo-turn'));
  expect(undone).toMatchObject({ ok: true, affectedBlockIds: [engine.snapshot().blocks[0].id] });
});
it.each(['actor', 'turnId', 'id', 'source'])('rejects a model-supplied %s', async key => {
  const before = editor.getJSON();
  expect(await executor.apply({ ...request(), [key]: 'spoof' }, context())).toMatchObject({ ok: false, code: 'INVALID' });
  expect(editor.getJSON()).toEqual(before);
});
it('deduplicates commits and refuses changed arguments under the same call ID', async () => {
  const input = request(); const first = await executor.apply(input, context());
  expect(await executor.apply(input, context())).toEqual(first);
  expect(engine.records).toHaveLength(1);
  expect(await executor.apply(request('other'), context())).toMatchObject({ code: 'DUPLICATE' });
});
it('vdoc#62: distinguishes arguments that differ only deep inside a 1 MB payload', async () => {
  const s = engine.snapshot(), base64 = 'A'.repeat(1024 * 1024);
  const image = (data: string) => ({ expectedSessionId: s.sessionId, expectedRevision: s.revision,
    target: { kind: 'text', blockId: s.blocks[0].id, start: 5, end: 5 }, operations: [{ type: 'image.insert', src: `data:image/png;base64,${data}` }] });
  const first = await executor.apply(image(base64), context());
  expect(first).toMatchObject({ ok: true });
  expect(await executor.apply(image(base64), context())).toEqual(first);
  const changed = base64.slice(0, 512 * 1024) + 'B' + base64.slice(512 * 1024 + 1);
  expect(await executor.apply(image(changed), context())).toMatchObject({ code: 'DUPLICATE' });
  expect(engine.records).toHaveLength(1);
});
it('aborts before writing', async () => {
  call.abort(); expect(await executor.apply(request(), context())).toMatchObject({ code: 'INTERRUPTED' });
  expect(editor.getText()).toContain('hello');
});
it('waits for composition and commits once after it ends', async () => {
  vi.useFakeTimers(); composing = true;
  const pending = executor.apply(request(), context());
  expect(engine.records).toHaveLength(0);
  composing = false; await vi.advanceTimersByTimeAsync(20);
  expect(await pending).toMatchObject({ ok: true }); expect(engine.records).toHaveLength(1);
});
it.each(['call', 'lifetime'])('cancels during composition via %s signal', async which => {
  vi.useFakeTimers(); composing = true;
  const pending = executor.apply(request(), context());
  (which === 'call' ? call : lifetime).abort();
  expect(await pending).toMatchObject({ code: 'INTERRUPTED' });
  composing = false; await vi.advanceTimersByTimeAsync(200); expect(engine.records).toHaveLength(0);
});
it('rechecks cancellation after the composition wait resolves, before continuation', async () => {
  vi.useFakeTimers(); composing = true;
  const pending = executor.apply(request(), context());
  composing = false; vi.advanceTimersByTime(20); call.abort();
  expect(await pending).toMatchObject({ code: 'INTERRUPTED' }); expect(engine.records).toHaveLength(0);
});
it('rejects a document switch during composition', async () => {
  vi.useFakeTimers(); composing = true;
  const pending = executor.apply(request(), context());
  current = { docId: 'other-doc', sessionId: engine.sessionId }; await vi.advanceTimersByTimeAsync(20);
  expect(await pending).toMatchObject({ code: 'UNAVAILABLE' }); expect(engine.records).toHaveLength(0);
});
it('times out bounded composition without a write', async () => {
  vi.useFakeTimers(); composing = true; const pending = executor.apply(request(), context());
  await vi.advanceTimersByTimeAsync(100);
  expect(await pending).toMatchObject({ code: 'TIMEOUT' }); expect(engine.records).toHaveLength(0);
});
it('revalidates version after composition instead of updating stale preconditions', async () => {
  vi.useFakeTimers(); composing = true; const pending = executor.apply(request(), context());
  composing = false; editor.commands.insertContent('user'); await vi.advanceTimersByTimeAsync(20);
  expect(await pending).toMatchObject({ code: 'STALE' }); expect(engine.records).toHaveLength(0);
});
it.each(['STALE', 'TARGET', 'INVALID', 'UNAVAILABLE'] as const)('preserves engine %s failure', async code => {
  vi.spyOn(engine, 'executeAgent').mockReturnValue({ ok: false, code, id: 'call-1', revision: 0, error: 'reason' });
  expect(await executor.apply(request(), context())).toMatchObject({ ok: false, code, error: 'reason' });
});
it('supports versioned, idempotent per-turn undo over unrelated typing', async () => {
  await executor.apply(request(), context());
  editor.commands.setTextSelection(engine.snapshot().blocks[1].from + 6); editor.commands.insertContent('!');
  const args = { targetTurnId: 'turn-1', expectedSessionId: engine.sessionId, expectedRevision: engine.revision };
  const result = await executor.undo(args, context('undo-1', 'undo-turn'));
  expect(result.ok).toBe(true); expect(engine.snapshot().blocks.map(b => b.text)).toEqual(['hello', 'second!']);
  expect(await executor.undo(args, context('undo-1', 'undo-turn'))).toEqual(result);
  expect(engine.history('undo', 'keyboard').ok).toBe(true); expect(engine.snapshot().blocks[1].text).toBe('second');
});
it('rejects stale undo without removing committed edits', async () => {
  await executor.apply(request(), context());
  expect(await executor.undo({ targetTurnId: 'turn-1', expectedSessionId: engine.sessionId, expectedRevision: 0 }, context('u', 'u'))).toMatchObject({ code: 'STALE' });
  expect(engine.snapshot().blocks[0].text).toBe('AI');
});

it('continues at the requested block across turns while the user cursor stays elsewhere', async () => {
  editor.commands.setTextSelection(2);
  const selection = editor.state.selection.toJSON();
  for (const [index, text] of [' first', ' next'].entries()) {
    const s = engine.snapshot(), block = s.blocks[1];
    expect(await executor.apply({ expectedSessionId: s.sessionId, expectedRevision: s.revision,
      target: { kind: 'text', blockId: block.id, start: block.text.length, end: block.text.length },
      operations: [{ type: 'text.insert', text }] }, context(`append-${index}`, `turn-${index}`))).toMatchObject({ ok: true });
    expect(editor.state.selection.toJSON()).toEqual(selection);
  }
  expect(engine.snapshot().blocks.map(block => block.text)).toEqual(['hello', 'second first next']);
});

it.each(['block', 'text', 'range'])('rejects insertion over existing content with a %s target atomically', async kind => {
  const s = engine.snapshot(), block = s.blocks[1];
  const target = kind === 'block' ? { kind, id: block.id }
    : kind === 'text' ? { kind, blockId: block.id, start: 0, end: block.text.length }
    : { kind, from: block.from, to: block.to };
  const before = editor.getJSON();
  expect(await executor.apply({ expectedSessionId: s.sessionId, expectedRevision: s.revision, target,
    operations: [{ type: 'text.style', style: { bold: true } }, { type: 'text.insert', text: 'new' }] }, context())).toMatchObject({ ok: false, error: expect.stringContaining('empty insertion target') });
  expect(editor.getJSON()).toEqual(before);
  expect(engine.revision).toBe(s.revision);
  expect(engine.records).toHaveLength(0);
});

it('continues in new paragraphs after the writing block without replacing it or following the cursor', async () => {
  editor.commands.setTextSelection(2);
  const selection = editor.state.selection.toJSON();
  for (const [index, text] of ['next paragraph', 'another paragraph'].entries()) {
    const s = engine.snapshot();
    expect(await executor.apply({ expectedSessionId: s.sessionId, expectedRevision: s.revision,
      target: { kind: 'block', id: s.blocks[s.blocks.length - 1].id },
      operations: [{ type: 'block.insert', beforeId: null, block: { kind: 'paragraph', text } }]
    }, context(`paragraph-${index}`, `turn-${index}`))).toMatchObject({ ok: true });
    expect(editor.state.selection.toJSON()).toEqual(selection);
  }
  expect(engine.snapshot().blocks.map(block => block.text)).toEqual(['hello', 'second', 'next paragraph', 'another paragraph']);
});
