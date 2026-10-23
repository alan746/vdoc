import { afterEach, beforeEach, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { createExtensions } from '../lib/editor/extensions';
import { DocumentEngine } from '../lib/usecases/engine';
import { createRealtimeExecutor } from '../lib/usecases/realtime-executor';
import { documentToolCatalog, realtimeDocumentTools } from '../lib/usecases/document-tools';
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
