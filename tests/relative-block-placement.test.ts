import { afterEach, beforeEach, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { createExtensions } from '../lib/editor/extensions';
import { DocumentEngine } from '../lib/usecases/engine';
import { createRealtimeExecutor } from '../lib/usecases/realtime-executor';
import { documentToolCatalog, realtimeDocumentTools } from '../lib/usecases/document-tools';
import type { RealtimeToolContext } from '../lib/usecases/ports';

let editor: Editor, engine: DocumentEngine, lifetime: AbortController;
let executor: ReturnType<typeof createRealtimeExecutor>;
const context = (callId = 'move', turnId = 'turn-1'): RealtimeToolContext => ({ callId, turnId, epoch: 1, signal: new AbortController().signal });
beforeEach(async () => {
  editor = new Editor({ extensions: createExtensions(), content: '<h1>计划</h1><p>甲</p><p>乙</p><p>丙</p>' });
  await new Promise(resolve => setTimeout(resolve, 0));
  engine = new DocumentEngine(editor); lifetime = new AbortController();
  executor = createRealtimeExecutor(engine, { docId: 'doc', actor: 'agent', signal: lifetime.signal, currentDocument: () => ({ docId: 'doc', sessionId: engine.sessionId }) });
});
afterEach(() => { lifetime.abort(); engine.destroy(); editor.destroy(); });
const blocks = () => engine.snapshot().blocks;
const id = (text: string) => blocks().find(block => block.text === text)!.id;
const order = () => blocks().filter(block => block.location.parentId === null).map(block => block.text);
const move = (source: string, anchor: string, relation: 'before' | 'after') => ({ type: 'block.move', id: id(source), position: { anchorId: id(anchor), relation } });
const request = (operations: unknown[], requestId?: string) => ({ ...(requestId ? { id: requestId } : {}), expectedSessionId: engine.sessionId, expectedRevision: engine.revision, target: { kind: 'block', id: id('甲') }, operations });

it.each([
  ['甲', '乙', 'after', ['计划', '乙', '甲', '丙']],
  ['丙', '甲', 'before', ['计划', '丙', '甲', '乙']],
  ['丙', '甲', 'after', ['计划', '甲', '丙', '乙']],
  ['甲', '丙', 'after', ['计划', '乙', '丙', '甲']],
  ['丙', '计划', 'before', ['丙', '计划', '甲', '乙']],
] as const)('moves %s %s %s without the model calculating an insertion index', (source, anchor, relation, expected) => {
  const sourceId = id(source), anchorId = id(anchor);
  const original = editor.getJSON();
  const result = engine.executeExternal(request([move(source, anchor, relation)]));
  expect(result.ok).toBe(true);
  expect(order()).toEqual(expected);
  expect(result.blockMoves).toMatchObject([{ id: sourceId, location: relation === 'after' ? { previousSiblingId: anchorId } : { nextSiblingId: anchorId } }]);
  expect(engine.history('undo', 'api').ok).toBe(true);
  expect(editor.getJSON()).toEqual(original);
});

it('keeps legacy beforeId and append requests working', () => {
  const a = id('甲'), c = id('丙');
  expect(engine.executeExternal(request([{ type: 'block.move', id: c, beforeId: a }])).ok).toBe(true);
  expect(order()).toEqual(['计划', '丙', '甲', '乙']);
  expect(engine.executeExternal(request([{ type: 'block.move', id: a, beforeId: null }])).ok).toBe(true);
  expect(order()).toEqual(['计划', '丙', '乙', '甲']);
});

it('treats an already adjacent placement as a no-op and still reports its position', () => {
  const revision = engine.revision;
  const result = engine.executeExternal(request([move('甲', '乙', 'before')]));
  expect(result).toMatchObject({ ok: true, revision, blockMoves: [{ id: id('甲'), location: { nextSiblingId: id('乙') } }] });
  expect(engine.records).toHaveLength(0);
});

it.each(['missing', 'conflicting', 'unsupported'] as const)('rejects %s placement atomically', kind => {
  const before = editor.getJSON(), revision = engine.revision;
  const operation = kind === 'missing' ? { type: 'block.move', id: id('甲') }
    : kind === 'conflicting' ? { ...move('甲', '丙', 'after'), beforeId: id('乙') }
      : { type: 'block.move', id: id('甲'), position: { anchorId: id('乙'), relation: 'inside' } };
  expect(engine.executeExternal(request([{ type: 'text.style', style: { bold: true } }, operation]))).toMatchObject({ ok: false, code: 'INVALID' });
  expect(editor.getJSON()).toEqual(before); expect(engine.revision).toBe(revision);
});

it.each(['absent', 'self'] as const)('refuses an %s anchor without moving content', kind => {
  const before = editor.getJSON();
  expect(engine.executeExternal(request([{ type: 'block.move', id: id('甲'), position: { anchorId: kind === 'self' ? id('甲') : 'missing', relation: 'after' } }])).ok).toBe(false);
  expect(editor.getJSON()).toEqual(before);
});

it('uses the live anchor after earlier operations in the same batch', () => {
  const a = id('甲'), b = id('乙'), c = id('丙');
  expect(engine.executeExternal(request([
    { type: 'block.move', id: c, position: { anchorId: a, relation: 'before' } },
    { type: 'block.move', id: b, position: { anchorId: c, relation: 'after' } },
  ])).ok).toBe(true);
  expect(order()).toEqual(['计划', '丙', '乙', '甲']);
});

it('reports the final positions when later operations move an earlier anchor again', () => {
  const a = id('甲'), b = id('乙'), c = id('丙');
  const result = engine.executeExternal(request([move('甲', '乙', 'after'), move('乙', '丙', 'after')]));
  expect(order()).toEqual(['计划', '甲', '丙', '乙']);
  expect(result.blockMoves).toMatchObject([
    { id: a, location: { nextSiblingId: c } }, { id: b, location: { previousSiblingId: c, nextSiblingId: null } },
  ]);
});

it('requires a fresh revision and never falls back to a different anchor after deletion', () => {
  const input = request([move('甲', '乙', 'after')]);
  expect(engine.execute({ operations: [{ type: 'block.delete', id: id('乙') }] }).ok).toBe(true);
  const before = editor.getJSON();
  expect(engine.executeExternal(input)).toMatchObject({ code: 'STALE' });
  expect(engine.executeExternal({ ...input, expectedRevision: engine.revision })).toMatchObject({ ok: false });
  expect(editor.getJSON()).toEqual(before);
});

it('rolls back earlier moves when a later anchor cannot be found', () => {
  const before = editor.getJSON();
  expect(engine.executeExternal(request([move('甲', '乙', 'after'), { type: 'block.move', id: id('丙'), position: { anchorId: 'gone', relation: 'before' } }]))).toMatchObject({ ok: false });
  expect(editor.getJSON()).toEqual(before);
});

it('supports relative insertion using the same placement contract', () => {
  expect(engine.executeExternal(request([{ type: 'block.insert', position: { anchorId: id('乙'), relation: 'after' }, block: { kind: 'paragraph', text: '新段落' } }])).ok).toBe(true);
  expect(order()).toEqual(['计划', '甲', '乙', '新段落', '丙']);
});

it('preserves a moved table and its cell IDs and rejects a nested paragraph as a sibling anchor', () => {
  expect(engine.execute({ operations: [{ type: 'block.insert', beforeId: id('乙'), block: { kind: 'table', rows: 2, cols: 2, header: true, headerText: ['项目', '金额'] } }] }).ok).toBe(true);
  const table = engine.snapshot().tables[0], tableNode = editor.state.doc.child(2).toJSON();
  const nested = blocks().find(block => block.location.topLevelId === table.id && block.id !== table.id)!;
  const before = editor.getJSON();
  expect(engine.executeExternal(request([{ type: 'block.move', id: id('甲'), position: { anchorId: nested.id, relation: 'after' } }])).ok).toBe(false);
  expect(editor.getJSON()).toEqual(before);
  expect(engine.executeExternal(request([{ type: 'block.move', id: table.id, position: { anchorId: id('丙'), relation: 'after' } }])).ok).toBe(true);
  expect(engine.snapshot().tables[0]).toEqual(table);
  let moved: unknown;
  editor.state.doc.forEach(node => { if (node.attrs.blockId === table.id) moved = node.toJSON(); });
  expect(moved).toEqual(tableNode);
});

it('exposes structural locations and frozen nearby context', () => {
  const a = blocks()[1], b = blocks()[2], c = blocks()[3], heading = blocks()[0];
  editor.commands.setTextSelection(b.from);
  const first = executor.getContext(context('read'));
  expect(first).toMatchObject({ blockContext: {
    selectedTopLevelBlockIds: [b.id], focus: { id: b.id, text: '乙' }, previous: { id: a.id }, next: { id: c.id }, heading: { id: heading.id },
  } });
  editor.commands.setTextSelection(a.from);
  expect(executor.getContext(context('again'))).toMatchObject({ blockContext: { focus: { id: b.id } } });
  expect(executor.getContext(context('next', 'turn-2'))).toMatchObject({ blockContext: { focus: { id: a.id } } });
  expect(engine.readBlocks([b.id]).blocks[0].location).toEqual({ parentId: null, topLevelId: b.id, previousSiblingId: a.id, nextSiblingId: c.id, headingId: heading.id });
});

it('returns placement evidence through the real tool boundary and deduplicates retries', async () => {
  const tools = realtimeDocumentTools(executor);
  const input = request([move('甲', '乙', 'after')]);
  delete input.id;
  const result = await tools.apply_document_operations.run(input, context());
  expect(result).toMatchObject({ ok: true, blockMoves: [{ id: id('甲'), location: { previousSiblingId: id('乙') } }] });
  const revision = engine.revision;
  expect(await tools.apply_document_operations.run(input, context())).toEqual(result);
  expect(engine.revision).toBe(revision);
  expect(engine.undoTurn('turn-1', { actor: 'agent', turnId: 'undo' }).ok).toBe(true);
  expect(order()).toEqual(['计划', '甲', '乙', '丙']);
});

it('describes the new position fields in the JSON schema actually sent to the model', () => {
  const json = JSON.stringify(documentToolCatalog.find(tool => tool.name === 'apply_document_operations')!.parameters);
  expect(json).toContain('anchorId'); expect(json).toContain('relation'); expect(json).toContain('before'); expect(json).toContain('after');
});

it('disambiguates repeated heading labels using IDs and the current section', async () => {
  editor.commands.setContent('<h2>预算</h2><p>第一部分</p><h2>预算</h2><p>第二部分</p><p>要移动的内容</p>');
  const headings = engine.outline();
  expect(headings.map(heading => heading.text)).toEqual(['预算', '预算']);
  expect(headings[0].id).not.toBe(headings[1].id);
  const second = blocks().find(block => block.text === '第二部分')!;
  editor.commands.setTextSelection(second.from);
  expect(executor.getContext(context('read-duplicates'))).toMatchObject({ blockContext: { heading: { id: headings[1].id } } });
  const input = { expectedSessionId: engine.sessionId, expectedRevision: engine.revision,
    target: { kind: 'block', id: id('要移动的内容') }, operations: [{ type: 'block.move', id: id('要移动的内容'), position: { anchorId: headings[1].id, relation: 'after' } }] };
  expect(await executor.apply(input, context('move-duplicates'))).toMatchObject({ ok: true, blockMoves: [{ location: { previousSiblingId: headings[1].id } }] });
  expect(order()).toEqual(['预算', '第一部分', '预算', '要移动的内容', '第二部分']);
});

it('distinguishes nested selection from its top-level container and reports actionable placement failures', async () => {
  editor.commands.setContent('<p>外部</p><table><tr><td>单元格里的内容</td></tr></table>');
  const table = engine.snapshot().tables[0], nested = blocks().find(block => block.text === '单元格里的内容' && block.id !== table.id)!;
  editor.commands.setTextSelection(nested.from + 1);
  expect(executor.getContext(context('nested-context'))).toMatchObject({ blockContext: {
    selectedTopLevelBlockIds: [table.id], focus: { id: table.id }, selectionPath: expect.arrayContaining([expect.objectContaining({ id: nested.id })]),
  } });
  expect(engine.selectionContext({ from: nested.from + 1, to: nested.from + 1 }).selectionPath.at(-1)).toMatchObject({ id: nested.id, location: { parentId: table.cells[0].id, topLevelId: table.id } });
  const input = { expectedSessionId: engine.sessionId, expectedRevision: engine.revision,
    target: { kind: 'block', id: id('外部') }, operations: [{ type: 'block.move', id: id('外部'), position: { anchorId: nested.id, relation: 'after' } }] };
  await expect(realtimeDocumentTools(executor).apply_document_operations.run(input, context('nested-failure'))).rejects.toThrow('placement anchor is missing or is not a top-level block');
});

it('bounds large selections and previews without concealing truncation', () => {
  editor.commands.setContent('<h1>长文档</h1>' + Array.from({ length: 45 }, (_, index) => `<p>${index === 0 ? '长'.repeat(1000) : index}</p>`).join(''));
  const context = engine.selectionContext({ from: blocks()[1].from, to: editor.state.doc.content.size });
  expect(context.selectedTopLevelBlockIds).toHaveLength(32);
  expect(context.selectionTruncated).toBe(true);
  expect(context.focus?.text).toHaveLength(240);
  expect(context.focus?.textTruncated).toBe(true);
});

it('does not describe ordinary list-item paragraphs as document-level blocks when the item has no ID', () => {
  editor.commands.setContent('<p>外部</p><ul><li><p>列表项</p></li></ul>');
  const nested = blocks().find(block => block.text === '列表项')!;
  expect(nested.location.parentId).toBe(nested.location.topLevelId);
  expect(nested.location.parentId).not.toBeNull();
  expect(engine.readBlocks([nested.location.topLevelId]).blocks[0]).toMatchObject({ type: 'bulletList', location: { parentId: null } });
  const before = editor.getJSON();
  expect(engine.executeExternal({ expectedSessionId: engine.sessionId, expectedRevision: engine.revision,
    target: { kind: 'block', id: id('外部') }, operations: [{ type: 'block.move', id: id('外部'), position: { anchorId: nested.id, relation: 'after' } }] })).toMatchObject({ ok: false });
  expect(editor.getJSON()).toEqual(before);
});

it('can initialize before stable IDs are assigned and then refreshes its structural context', async () => {
  const freshEditor = new Editor({ extensions: createExtensions(), content: '<ul><li><p>刚打开的列表</p></li></ul>' });
  const freshEngine = new DocumentEngine(freshEditor);
  try {
    expect(() => freshEngine.selectionContext({ from: 1, to: 1 })).not.toThrow();
    await new Promise(resolve => setTimeout(resolve, 0));
    const selected = freshEngine.selectionContext({ from: 3, to: 3 });
    expect(selected.focus).toMatchObject({ type: 'bulletList', text: '刚打开的列表' });
    expect(selected.selectionPath.at(-1)).toMatchObject({ type: 'paragraph' });
  } finally { freshEngine.destroy(); freshEditor.destroy(); }
});
