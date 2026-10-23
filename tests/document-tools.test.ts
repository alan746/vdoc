import { afterEach, beforeEach, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { createExtensions } from '../lib/editor/extensions';
import { DocumentEngine } from '../lib/usecases/engine';
import { createRealtimeExecutor } from '../lib/usecases/realtime-executor';
import { documentToolCatalog, externalDocumentSchema, realtimeDocumentTools } from '../lib/usecases/document-tools';
import { registerDocumentTools } from '../lib/usecases/browser-tools';
import type { RealtimeToolContext } from '../lib/usecases/ports';

// vdoc#30: one catalog of name/description/parameters/readOnly, shared by
// @vrealtime/client (every entry, via realtimeDocumentTools) and the WebMCP
// bridge (browser-tools.ts, only the entries that need no agent turn).

let editor: Editor, engine: DocumentEngine, lifetime: AbortController;
let executor: ReturnType<typeof createRealtimeExecutor>;
const context = (callId = 'call-1', turnId = 'turn-1'): RealtimeToolContext => ({ callId, turnId, epoch: 1, signal: new AbortController().signal });
beforeEach(async () => {
  editor = new Editor({ extensions: createExtensions(), content: '<h1>Title</h1><p>hello</p><p>second</p>' });
  await new Promise(resolve => setTimeout(resolve, 0));
  engine = new DocumentEngine(editor); lifetime = new AbortController();
  executor = createRealtimeExecutor(engine, { docId: 'doc-1', actor: 'trusted-agent', signal: lifetime.signal, currentDocument: () => ({ docId: 'doc-1', sessionId: engine.sessionId }) });
});
afterEach(() => { lifetime.abort(); engine.destroy(); editor.destroy(); });

const request = (operations: unknown[]) => ({
  expectedSessionId: engine.sessionId, expectedRevision: engine.revision,
  target: { kind: 'block', id: engine.snapshot().blocks[1].id }, operations,
});
const format = { bold: true, italic: false, underline: false, strike: false, color: null, highlight: null, fontFamily: 'Arial', fontSize: 12, script: 'normal' };

it('lists exactly the five catalog entries with the right readOnly flags', () => {
  expect(documentToolCatalog.map(entry => [entry.name, entry.readOnly])).toEqual([
    ['read_document', true], ['read_blocks', true], ['get_context', true],
    ['apply_document_operations', false], ['undo_turn', false],
  ]);
});

it('wires every catalog entry into a working realtime tool sourced from the same description/parameters', () => {
  const tools = realtimeDocumentTools(executor);
  for (const entry of documentToolCatalog) {
    expect(tools[entry.name].description).toBe(entry.description);
    expect(tools[entry.name].parameters).toBe(entry.parameters);
  }
  expect(tools.read_document.run({}, context())).toMatchObject({ docId: 'doc-1' });
  expect(tools.get_context.run({}, context())).toMatchObject({ outline: [{ level: 1, text: 'Title' }] });
  expect(tools.read_blocks.run({ ids: [engine.snapshot().blocks[0].id] }, context())).toMatchObject({ blocks: [{}] });
});

it('registers only the turn-free catalog entries for WebMCP, excluding get_context and undo_turn', () => {
  const registered: { name: string; readOnlyHint: boolean }[] = [];
  const dispose = registerDocumentTools(engine, { registerTool: tool => { registered.push({ name: tool.name, readOnlyHint: tool.annotations.readOnlyHint }); } });
  expect(registered.map(t => t.name).sort()).toEqual(['apply_document_operations', 'read_blocks', 'read_document']);
  expect(registered.find(t => t.name === 'read_blocks')?.readOnlyHint).toBe(true);
  expect(registered.find(t => t.name === 'apply_document_operations')?.readOnlyHint).toBe(false);
  dispose();
});

it('WebMCP read_blocks validates its input and reads full block content, matching the realtime shape minus docId/sessionId', () => {
  const tools: { name: string; execute: (input: unknown) => unknown }[] = [];
  registerDocumentTools(engine, { registerTool: tool => { tools.push(tool); } });
  const readBlocks = tools.find(t => t.name === 'read_blocks')!;
  const id = engine.snapshot().blocks[1].id;
  expect(readBlocks.execute({ ids: [id] })).toMatchObject({ blocks: [{ id, type: 'paragraph', text: 'hello' }] });
  expect(readBlocks.execute({ ids: [] })).toMatchObject({ ok: false, code: 'INVALID' });
});

it('reports the missing deletion field and no edit at the realtime boundary, keeping executor failures structured', async () => {
  const input = request([{ type: 'block.delete' }]);
  const before = editor.getJSON(), revision = engine.revision;
  expect(await executor.apply(input, context())).toMatchObject({ ok: false, code: 'INVALID', error: 'operations[0].id: Required' });
  await expect(realtimeDocumentTools(executor).apply_document_operations.run(input, context())).rejects.toThrow('INVALID: operations[0].id: Required This call did NOT apply an edit.');
  expect(editor.getJSON()).toEqual(before); expect(engine.revision).toBe(revision);
  expect(engine.records).toHaveLength(0);
});

it('deletes an explicitly identified block once, replays success, and rejects changed arguments', async () => {
  const tool = realtimeDocumentTools(executor).apply_document_operations;
  const input = request([{ type: 'block.delete', id: engine.snapshot().blocks[1].id }]);
  const result = await tool.run(input, context());
  const revision = engine.revision;
  expect(result).toMatchObject({ ok: true });
  expect(engine.snapshot().blocks.map(block => block.text)).toEqual(['Title', 'second']);
  expect(await tool.run(input, context())).toEqual(result);
  expect(engine.revision).toBe(revision); expect(engine.records).toHaveLength(1);
  await expect(tool.run(request([{ type: 'text.replace', text: 'changed' }]), context())).rejects.toThrow('DUPLICATE:');
  expect(engine.revision).toBe(revision);
});

it('turns undo failures into errors while successful undo and its replay stay idempotent', async () => {
  const tools = realtimeDocumentTools(executor);
  await tools.apply_document_operations.run(request([{ type: 'text.replace', text: 'AI' }]), context());
  const undo = { expectedSessionId: engine.sessionId, expectedRevision: engine.revision, targetTurnId: 'turn-1' };
  await expect(tools.undo_turn.run({ ...undo, expectedRevision: undo.expectedRevision - 1 }, context('stale', 'undo'))).rejects.toThrow('STALE:');
  expect(engine.snapshot().blocks[1].text).toBe('AI');
  const result = await tools.undo_turn.run(undo, context('undo', 'undo'));
  expect(result).toMatchObject({ ok: true });
  const revision = engine.revision;
  expect(await tools.undo_turn.run(undo, context('undo', 'undo'))).toEqual(result);
  expect(engine.revision).toBe(revision); expect(engine.snapshot().blocks[1].text).toBe('hello');
});

it('surfaces synchronous read failures too, without describing them as failed edits', () => {
  const tools = realtimeDocumentTools(executor);
  expect(() => tools.read_blocks.run({ ids: [] }, context())).toThrow(/INVALID: ids: .*The read failed/);
  lifetime.abort();
  for (const name of ['read_document', 'read_blocks', 'get_context']) {
    expect(() => tools[name].run({ ids: ['id'] }, context())).toThrow(/INTERRUPTED: .*The read failed/);
  }
});

it('excludes format paste from the realtime schema and rejects the whole batch before writing', async () => {
  const tool = realtimeDocumentTools(executor).apply_document_operations;
  expect(JSON.stringify(tool.parameters)).not.toContain('format.apply');
  expect(JSON.stringify(externalDocumentSchema)).toContain('format.apply');
  const input = request([{ type: 'text.replace', text: 'changed' }, { type: 'format.apply', format }]);
  const before = editor.getJSON(), revision = engine.revision;
  expect(await executor.apply(input, context())).toMatchObject({ ok: false, code: 'INVALID' });
  await expect(tool.run(input, context())).rejects.toThrow('INVALID: operations[1].type:');
  expect(editor.getJSON()).toEqual(before); expect(engine.revision).toBe(revision);
});

it('keeps format paste available through the existing external operation API', () => {
  const result = engine.executeExternal(request([{ type: 'format.apply', format }]));
  expect(result).toMatchObject({ ok: true });
  const marks = editor.state.doc.child(1).firstChild!.marks;
  expect(marks.some(mark => mark.type.name === 'bold')).toBe(true);
  expect(marks.find(mark => mark.type.name === 'textStyle')?.attrs).toMatchObject({ fontFamily: 'Arial', fontSize: '12px' });
});

it.each(['bold', 'italic'] as const)('explicit %s changes preserve font, size, color and other marks, including on a second request', async style => {
  editor.commands.setContent('<h1>Title</h1><p><span style="font-family: Georgia; font-size: 24px; color: #123456"><u>hello</u></span></p>');
  const tool = realtimeDocumentTools(executor).apply_document_operations;
  const otherMarks = () => editor.state.doc.child(1).firstChild!.marks.filter(mark => mark.type.name !== style && mark.type.name !== 'formatOverride').map(mark => mark.toJSON());
  const original = otherMarks();
  for (const callId of ['first', 'second']) {
    expect(await tool.run(request([{ type: 'text.style', style: { [style]: true } }]), context(callId))).toMatchObject({ ok: true });
    expect(editor.state.doc.child(1).firstChild!.marks.some(mark => mark.type.name === style)).toBe(true);
    expect(otherMarks()).toEqual(original);
  }
  expect(await tool.run(request([{ type: 'text.style', style: { [style]: false } }]), context('disable'))).toMatchObject({ ok: true });
  expect(editor.state.doc.child(1).firstChild!.marks.some(mark => mark.type.name === style)).toBe(false);
  expect(otherMarks()).toEqual(original);
});
