import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { createExtensions } from '../lib/editor/extensions';
import { DocumentEngine } from '../lib/usecases/engine';
import { changedBlockIds } from '../lib/editor/document/changed-blocks';
import type { AppliedChange } from '../lib/domain/entities/operation';

let editor: Editor, engine: DocumentEngine, events: AppliedChange[];
beforeEach(async () => {
  editor = new Editor({ extensions: createExtensions(), content: '<p>One</p><p>Two</p><table><tr><td>A</td><td>B</td></tr></table>' });
  await new Promise(resolve => setTimeout(resolve, 0));
  engine = new DocumentEngine(editor); events = [];
  engine.onApplied(event => events.push(event));
});
afterEach(() => { engine.destroy(); editor.destroy(); });
const request = (operations: unknown[], index = 0) => {
  const s = engine.snapshot();
  return { id: 'edit', expectedSessionId: s.sessionId, expectedRevision: s.revision, target: { kind: 'block', id: s.blocks[index].id }, operations };
};

it.each([
  { type: 'text.replace', text: 'New' },
  { type: 'text.style', style: { bold: true } },
  { type: 'paragraph.style', align: 'right' },
])('reports just the edited text block for $type', operation => {
  const input = request([operation]);
  const result = engine.executeExternal(input);
  expect(result.ok).toBe(true);
  expect(events).toEqual([expect.objectContaining({ id: 'edit', source: 'api', revision: result.revision, changedBlockIds: [input.target.id], documentChanged: true })]);
});

it('emits once for a batch and includes agent identity', () => {
  const input = request([{ type: 'text.style', style: { bold: true } }, { type: 'paragraph.style', align: 'center' }]);
  expect(engine.executeAgent({ ...input, label: 'Style first paragraph' }, { actor: 'assistant', turnId: 'turn-a' }).ok).toBe(true);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ label: 'Style first paragraph', source: 'agent', actor: 'assistant', turnId: 'turn-a', changedBlockIds: [input.target.id] });
});

it('reports cell content and cell attributes at the innermost text block', () => {
  const s = engine.snapshot(), table = s.tables[0];
  const input = { expectedSessionId: s.sessionId, expectedRevision: s.revision, target: { kind: 'cell', tableId: table.id, cellId: table.cells[0].id }, operations: [{ type: 'table.background', color: '#FF0000' }] };
  expect(engine.executeExternal(input).ok).toBe(true);
  expect(events[0].changedBlockIds).toEqual([s.blocks.find(b => b.text === 'A')!.id]);
});

it('reports the table alone for a structural edit', () => {
  const s = engine.snapshot(), table = s.tables[0];
  expect(engine.executeExternal({ expectedSessionId: s.sessionId, expectedRevision: s.revision, target: { kind: 'cell', tableId: table.id, cellId: table.cells[0].id }, operations: [{ type: 'table.edit', action: 'rowAfter' }] }).ok).toBe(true);
  expect(events[0].changedBlockIds).toEqual([table.id]);
});

it('includes newly normalized IDs and emits only once for inserted blocks', () => {
  const beforeIds = new Set(engine.snapshot().blocks.map(b => b.id));
  editor.commands.setTextSelection(2);
  expect(engine.execute({ operations: [{ type: 'block.rule' }] }).ok).toBe(true);
  const created = engine.snapshot().blocks.filter(b => !beforeIds.has(b.id));
  expect(created.length).toBeGreaterThan(0);
  expect(events).toHaveLength(1);
  expect(events[0].changedBlockIds).toEqual(expect.arrayContaining(created.map(b => b.id)));
  expect(events[0].changedBlockIds.every(Boolean)).toBe(true);
});

it('reports deleted blocks without including unchanged shifted siblings', () => {
  const before = editor.state.doc, deleted = engine.snapshot().blocks[0].id;
  const after = editor.state.tr.delete(0, before.firstChild!.nodeSize).doc;
  expect(changedBlockIds(before, after)).toEqual([deleted]);
});

it('detects attribute and node-mark steps with empty position maps', () => {
  editor.commands.setContent({ type: 'doc', content: [{ type: 'image', attrs: { src: 'data:image/png;base64,AAAA', width: 100 } }] });
  const before = editor.state.doc, id = engine.snapshot().blocks[0].id;
  const attribute = editor.state.tr.setNodeAttribute(0, 'width', 200).doc;
  expect(changedBlockIds(before, attribute)).toEqual([id]);
  editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }, { type: 'footnote', attrs: { text: 'note' } }] }] });
  const inlineBefore = editor.state.doc, paragraphId = engine.snapshot().blocks[0].id;
  const mark = editor.state.tr.addNodeMark(2, editor.schema.marks.bold.create()).doc;
  expect(changedBlockIds(inlineBefore, mark)).toEqual([paragraphId]);
});

it('reports root attributes without falsely highlighting every block', () => {
  expect(engine.execute({ operations: [{ type: 'document.language', language: 'fr' }] }).ok).toBe(true);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ changedBlockIds: [], documentChanged: true });
});

it('reports stored marks without claiming the document changed', () => {
  editor.commands.setTextSelection(2);
  expect(engine.execute({ operations: [{ type: 'text.style', style: { bold: true } }] }).ok).toBe(true);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ documentChanged: false, changedBlockIds: [] });
});

it('does not publish failed, stale, no-op or duplicate requests', () => {
  const input = request([{ type: 'text.style', style: { bold: true } }]);
  expect(engine.executeExternal(input).ok).toBe(true);
  events.length = 0;
  expect(engine.executeExternal(input).ok).toBe(true);
  expect(engine.executeExternal({ ...input, id: 'stale' }).code).toBe('STALE');
  expect(engine.executeExternal({ ...request([{ type: 'text.style', style: { bold: true } }]), id: 'noop' }).ok).toBe(true);
  expect(engine.executeExternal({ ...request([{ type: 'text.style', style: { italic: true } }, { type: 'table.edit', action: 'deleteRow' }]), id: 'failed' }).ok).toBe(false);
  expect(events).toEqual([]);
});

it('keeps subscriptions independent and clears applied listeners on destroy', () => {
  const applied = vi.fn(), legacy = vi.fn();
  const unsubscribe = engine.onApplied(applied), stopLegacy = engine.subscribe(legacy);
  unsubscribe();
  expect(engine.executeExternal(request([{ type: 'text.replace', text: 'x' }])).ok).toBe(true);
  expect(applied).not.toHaveBeenCalled(); expect(legacy).toHaveBeenCalled();
  stopLegacy(); engine.destroy();
  expect(engine.executeExternal(request([{ type: 'text.replace', text: 'y' }])).code).toBe('UNAVAILABLE');
  expect(events).toHaveLength(1);
});

it('attributes list wrapping to the affected paragraph', () => {
  const input = request([{ type: 'list.toggle', kind: 'bullet' }]);
  expect(engine.executeExternal(input).ok).toBe(true);
  expect(events[0].changedBlockIds).toEqual([input.target.id]);
});
