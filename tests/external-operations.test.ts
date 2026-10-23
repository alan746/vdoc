import { afterEach, beforeEach, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { createExtensions } from '../lib/editor/extensions';
import { DocumentEngine } from '../lib/usecases/engine';
import { registerDocumentTools } from '../lib/usecases/browser-tools';
import { documentNavigation } from '../lib/usecases/document-navigation';
let editor: Editor, engine: DocumentEngine;
beforeEach(async () => {
  editor = new Editor({ extensions: createExtensions(), content: '<p>中文 العربية</p><table data-pinned-rows="0"><tr><td>20</td><td>日本語</td></tr><tr><td>3</td><td>हिन्दी</td></tr></table>' });
  await new Promise(r => setTimeout(r, 0)); engine = new DocumentEngine(editor);
});
afterEach(() => { engine.destroy(); editor.destroy(); });
const request = () => { const s = engine.snapshot(), t = s.tables[0]; return { expectedSessionId: s.sessionId, expectedRevision: s.revision, target: { kind: 'cell', tableId: t.id, cellId: t.cells[0].id }, operations: [{ type: 'table.background', color: '#FFF0AD' }] }; };
it('publishes a distinct session even when two editors have equal revisions', () => {
  const other = new DocumentEngine(editor);
  try { const before = editor.getJSON(); expect(other.revision).toBe(engine.revision); expect(other.executeExternal(request()).code).toBe('STALE'); expect(editor.getJSON()).toEqual(before); }
  finally { other.destroy(); }
});
it.each(['expectedSessionId', 'target'])('requires %s at the external boundary', field => {
  const input: Record<string, unknown> = request(); delete input[field]; const before = editor.getJSON();
  expect(engine.executeExternal(input).code).toBe('INVALID'); expect(editor.getJSON()).toEqual(before);
});
it('forbids an implicit changing selection and source impersonation at the external boundary', () => {
  expect(engine.executeExternal({ ...request(), target: { kind: 'selection' } }).code).toBe('INVALID');
  expect(engine.executeExternal({ ...request(), source: 'toolbar' }).code).toBe('INVALID');
});
it('rejects a delayed edit after native typing, even when its cell still exists', () => {
  const input = request(); editor.commands.insertContent('New '); const before = editor.getJSON();
  expect(engine.executeExternal(input).code).toBe('STALE'); expect(editor.getJSON()).toEqual(before);
});
it('uses the stable cell after row movement only after reading a fresh revision', () => {
  const original = request(), id = original.target.cellId;
  expect(engine.execute({ target: original.target, operations: [{ type: 'table.move', axis: 'row', from: 0, to: 1 }] }).ok).toBe(true);
  expect(engine.executeExternal(original).code).toBe('STALE');
  const snapshot = engine.snapshot(); expect(snapshot.tables[0].cells.find(c => c.id === id)?.row).toBe(1);
  const before = editor.getJSON(); expect(engine.executeExternal({ ...original, expectedRevision: snapshot.revision }).ok).toBe(true);
  const table = editor.state.doc.child(1); expect(table.child(1).child(0).attrs.backgroundColor).toBe('#FFF0AD'); expect(table.child(0).child(0).attrs.backgroundColor).toBeNull();
  engine.history('undo', 'api'); expect(editor.getJSON()).toEqual(before);
});
it('does not retarget a deleted cell to the cell occupying its former coordinate', () => {
  const input = request(); engine.execute({ target: input.target, operations: [{ type: 'table.edit', action: 'deleteRow' }] });
  const before = editor.getJSON(); expect(engine.executeExternal({ ...input, expectedRevision: engine.revision }).code).toBe('TARGET'); expect(editor.getJSON()).toEqual(before);
});
it('returns the original result for an identical retry without applying twice', () => {
  const input = { ...request(), id: 'external-retry', operations: [{ type: 'table.edit', action: 'rowAfter' }] };
  const first = engine.executeExternal(input), before = editor.getJSON(); expect(first.ok).toBe(true);
  expect(engine.executeExternal(input)).toEqual(first); expect(editor.getJSON()).toEqual(before);
  expect(engine.executeExternal({ ...input, operations: [{ type: 'table.edit', action: 'rowBefore' }] }).code).toBe('DUPLICATE');
});
it('refuses cached or new requests and history commands after the session closes', () => {
  const input = { ...request(), id: 'closed-retry' }; expect(engine.executeExternal(input).ok).toBe(true);
  const before = editor.getJSON(); engine.destroy();
  expect(engine.executeExternal(input).code).toBe('UNAVAILABLE'); expect(engine.history('undo', 'api').code).toBe('UNAVAILABLE'); expect(editor.getJSON()).toEqual(before);
});
it('describes merged cells once with logical spans and resolves cells in nested tables without mixing them', () => {
  editor.commands.setContent('<table><tr><td colspan="2">标题<table><tr><td>Nested</td></tr></table></td></tr><tr><td>A</td><td>B</td></tr></table>');
  const s = engine.snapshot(), [outer, inner] = s.tables;
  expect(outer.cells).toHaveLength(3); expect(outer.cells[0]).toMatchObject({ row: 0, column: 0, colspan: 2, rowspan: 1 }); expect(inner.cells).toHaveLength(1);
  expect(engine.executeExternal({ ...request(), target: { kind: 'cell', tableId: outer.id, cellId: inner.cells[0].id } }).code).toBe('TARGET');
  expect(engine.executeExternal({ ...request(), target: { kind: 'cell', tableId: inner.id, cellId: inner.cells[0].id } }).ok).toBe(true);
});
it('rolls back a failed external batch including earlier valid operations', () => {
  const before = editor.getJSON(), revision = engine.revision, canUndo = engine.canUndo;
  expect(engine.executeExternal({ ...request(), operations: [{ type: 'table.background', color: '#FFF0AD' }, { type: 'table.move', axis: 'row', from: 0, to: 999 }] }).ok).toBe(false);
  expect(editor.getJSON()).toEqual(before); expect(engine.revision).toBe(revision); expect(engine.canUndo).toBe(canUndo);
});
it('rejects an external edit while a workspace field is composing and permits the same request after it finishes', () => {
  let composing = true;
  const unregister = documentNavigation(editor).registerCompositionGuard(() => composing);
  try {
    const input = { ...request(), id: 'field-composition-retry' };
    const before = engine.snapshot(), canUndo = engine.canUndo;
    expect(editor.view.composing).toBe(false);
    expect(engine.executeExternal(input).code).toBe('COMPOSING');
    expect(engine.snapshot()).toEqual(before); expect(engine.canUndo).toBe(canUndo);
    composing = false;
    expect(engine.executeExternal(input).ok).toBe(true);
    const applied = editor.getJSON();
    expect(engine.executeExternal(input).ok).toBe(true); expect(editor.getJSON()).toEqual(applied);
    expect(engine.history('undo', 'api').ok).toBe(true); expect(editor.getJSON()).toEqual(before.document);
  } finally { unregister(); }
});
it.each(['undo', 'redo'] as const)('preserves history when %s arrives during composition outside the document body', action => {
  const original = editor.getJSON(); expect(engine.executeExternal(request()).ok).toBe(true);
  const edited = editor.getJSON();
  if (action === 'redo') expect(engine.history('undo', 'api').ok).toBe(true);
  const before = engine.snapshot(), canUndo = engine.canUndo, canRedo = engine.canRedo;
  const unregister = documentNavigation(editor).registerCompositionGuard(() => true);
  try {
    expect(editor.view.composing).toBe(false);
    expect(engine.history(action, 'api').code).toBe('COMPOSING');
    expect(engine.snapshot()).toEqual(before);
    expect(engine.canUndo).toBe(canUndo); expect(engine.canRedo).toBe(canRedo);
  } finally { unregister(); }
  expect(engine.history(action, 'api').ok).toBe(true);
  expect(editor.getJSON()).toEqual(action === 'undo' ? original : edited);
});
it('registers the guarded schema and aborts the tools with the editor lifecycle', () => {
  type RegisteredTool = Parameters<NonNullable<Parameters<typeof registerDocumentTools>[1]>['registerTool']>[0];
  const registered: { tool: RegisteredTool; signal: AbortSignal }[] = [];
  const dispose = registerDocumentTools(engine, { registerTool: (tool, options) => { registered.push({ tool, signal: options.signal }); } });
  const apply = registered.find(t => t.tool.name === 'apply_document_operations')!;
  expect(apply.tool.inputSchema).toMatchObject({ required: expect.arrayContaining(['expectedSessionId', 'target']), properties: expect.objectContaining({ expectedBlocks: expect.any(Object), expectedRevision: expect.any(Object) }) });
  expect(apply.tool.execute({ operations: [{ type: 'text.insert', text: 'unsafe' }] })).toMatchObject({ code: 'INVALID' });
  expect(apply.tool.execute(request())).toMatchObject({ ok: true }); dispose(); expect(apply.signal.aborted).toBe(true);
});
