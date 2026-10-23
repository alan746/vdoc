import { afterEach, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { createExtensions } from '../lib/editor/extensions';
import { DocumentEngine } from '../lib/usecases/engine';

// vdoc#60: record() does no turn bookkeeping for steps that never leave, no
// inverse for user steps, and evicts without shifting the whole log.

type Internals = { entries: { turnId?: string; inverse?: unknown }[]; head: number; turns: Map<string, { entries: number }>; evict(entry: unknown): void; compact(): void };
let editor: Editor, engine: DocumentEngine;
const open = async (undoStepLimit?: number) => {
  editor = new Editor({ extensions: createExtensions(), content: '<p>hello</p><p>second</p>' });
  await new Promise(resolve => setTimeout(resolve, 0));
  engine = new DocumentEngine(editor, { undoStepLimit });
};
afterEach(() => { engine.destroy(); editor.destroy(); vi.restoreAllMocks(); });
const history = () => (engine as unknown as { turnHistory: Internals }).turnHistory;
const retained = () => history().entries.slice(history().head);
const agentEdit = (turnId: string, text: string) => {
  const s = engine.snapshot(), block = s.blocks[1];
  return engine.executeAgent({ expectedSessionId: s.sessionId, expectedRevision: s.revision, target: { kind: 'text', blockId: block.id, start: 0, end: 0 }, operations: [{ type: 'text.insert', text }] }, { actor: 'assistant', turnId });
};
const type = (text: string) => { editor.commands.setTextSelection(2); editor.commands.insertContent(text); };

it('keeps an inverse only for agent steps', async () => {
  await open();
  type('x');
  expect(agentEdit('a', 'AI').ok).toBe(true);
  const entries = retained();
  expect(entries.filter(entry => !entry.turnId).length).toBeGreaterThan(0);
  expect(entries.filter(entry => !entry.turnId).every(entry => !('inverse' in entry))).toBe(true);
  expect(entries.filter(entry => entry.turnId === 'a').every(entry => entry.inverse)).toBe(true);
});

it('does no eviction or compaction work for a selection-only transaction', async () => {
  await open(3);
  expect(agentEdit('a', 'AI').ok).toBe(true);
  type('1'); type('2'); type('3');
  const evict = vi.spyOn(history(), 'evict'), compact = vi.spyOn(history(), 'compact');
  const before = retained().length;
  editor.commands.setTextSelection(4);
  expect(evict).not.toHaveBeenCalled(); expect(compact).not.toHaveBeenCalled();
  expect(retained()).toHaveLength(before);
});

it('forgets a turn with its last evicted step and stays bounded across compactions', async () => {
  await open(3);
  expect(agentEdit('a', 'AI').ok).toBe(true);
  expect(history().turns.get('a')?.entries).toBeGreaterThan(0);
  for (let i = 0; i < 20; i++) type(String(i % 10));
  expect(history().turns.has('a')).toBe(false);
  expect(retained()).toHaveLength(3);
  expect(history().entries.length).toBeLessThanOrEqual(2 * 3 + 1);
  expect(engine.undoTurn('a', { actor: 'assistant', turnId: 'u1' })).toMatchObject({ ok: false });
  // Index-based reads after many evictions still see the right entries.
  expect(agentEdit('b', 'B').ok).toBe(true);
  const before = editor.getText();
  expect(engine.undoTurn('b', { actor: 'assistant', turnId: 'u2' }).ok).toBe(true);
  expect(editor.getText()).toBe(before.replace('B', ''));
});
