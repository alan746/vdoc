import { afterEach, beforeEach, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { createExtensions } from '../lib/editor/extensions';
import { DocumentEngine } from '../lib/usecases/engine';

// The year-end review eval asked to bold every number in a section. With one
// target per call the agent bolded them one call at a time and ran into the
// server's 12-calls-per-turn limit; text.styleMatches styles them all in one call.

let editor: Editor, engine: DocumentEngine;
const origin = { actor: 'agent-1', turnId: 'turn-1' };
beforeEach(async () => {
  editor = new Editor({ extensions: createExtensions(), content: '<h2>业绩回顾</h2><p>营收 2.86 亿元，增长 24.3%。</p><p>净利润 3,850 万元，增长 18.7%。</p><h2>明年计划</h2><p>营收增长 24.3% 以上。</p>' });
  await new Promise(resolve => setTimeout(resolve, 0));
  engine = new DocumentEngine(editor);
});
afterEach(() => { engine.destroy(); editor.destroy(); });
const version = () => { const s = engine.snapshot(); return { expectedSessionId: s.sessionId, expectedRevision: s.revision }; };
const block = (prefix: string) => engine.snapshot().blocks.find(b => b.text.startsWith(prefix))!;
const styleMatches = (operation: Record<string, unknown>) => engine.executeAgent({ ...version(), target: { kind: 'block', id: block('营收 2.86').id }, operations: [{ type: 'text.styleMatches', ...operation }] }, origin);
const bold = () => { const found: string[] = []; editor.state.doc.descendants(node => { if (node.isText && node.marks.some(mark => mark.type.name === 'bold')) found.push(node.text!); }); return found; };

it('bolds every number of a section in one call', () => {
  const result = styleMatches({ queries: ['2.86', '24.3%', '3,850', '18.7%'], style: { bold: true }, blockIds: [block('营收 2.86').id, block('净利润').id] });
  expect(result.ok).toBe(true);
  expect(bold()).toEqual(['2.86', '24.3%', '3,850', '18.7%']);
});

it('styles every occurrence across the document when no blocks are given', () => {
  expect(styleMatches({ queries: ['24.3%'], style: { color: '#ff0000' } }).ok).toBe(true);
  let red = 0;
  editor.state.doc.descendants(node => { if (node.isText && node.text === '24.3%' && node.marks.some(mark => mark.attrs.color === '#ff0000')) red++; });
  expect(red).toBe(2);
});

it('says when nothing matches and leaves the document unchanged', () => {
  const before = editor.getJSON();
  const result = styleMatches({ queries: ['9.99'], style: { bold: true } });
  expect(result).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
  expect(result.error).toContain('nothing was styled');
  expect(editor.getJSON()).toEqual(before);
});

it('keeps the user caret where it was', () => {
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 3)));
  expect(styleMatches({ queries: ['18.7%'], style: { underline: true } }).ok).toBe(true);
  expect(editor.state.selection.from).toBe(3);
  expect(editor.state.selection.empty).toBe(true);
});

it('is one undoable agent turn', () => {
  const before = editor.getJSON();
  expect(styleMatches({ queries: ['2.86', '3,850'], style: { bold: true } }).ok).toBe(true);
  expect(engine.undoTurn(origin.turnId, { actor: 'agent-1', turnId: 'turn-2' }).ok).toBe(true);
  expect(editor.getJSON()).toEqual(before);
});
