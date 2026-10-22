import { Editor } from '@tiptap/core';
import { afterEach, expect, it } from 'vitest';
import { createExtensions } from '../lib/editor/extensions';
import { findMatches } from '../lib/editor/search/search';
import { DocumentEngine } from '../lib/usecases/engine';
let editor: Editor | undefined, engine: DocumentEngine | undefined;
afterEach(() => { engine?.destroy(); editor?.destroy(); engine = undefined; editor = undefined; });
it('keeps long-document search coordinates accurate through local edits, replacement and undo', async () => {
  const text = '中文 日本語 العربية cafe\u0301 👩‍💻 TARGET and TARGETED';
  editor = new Editor({ extensions: createExtensions(), content: { type: 'doc', content: Array.from({ length: 2500 }, () => ({ type: 'paragraph', content: [{ type: 'text', text }] })) } });
  await new Promise(resolve => setTimeout(resolve, 0)); engine = new DocumentEngine(editor);
  const baseline = editor.getJSON();
  expect(findMatches(editor.state.doc, 'café')).toHaveLength(2500);
  expect(findMatches(editor.state.doc, 'TARGET', false, true)).toHaveLength(2500);
  const durations: number[] = [];
  for (let i = 0; i < 12; i++) {
    const first = findMatches(editor.state.doc, 'TARGET')[0];
    editor.commands.insertContentAt(first.from, 'x');
    const start = performance.now();
    const matches = findMatches(editor.state.doc, 'café');
    durations.push(performance.now() - start);
    expect(matches).toHaveLength(2500);
    expect(editor.state.doc.textBetween(matches.at(-1)!.from, matches.at(-1)!.to)).toBe('cafe\u0301');
  }
  const beforeReplace = editor.getJSON();
  expect(engine.execute({ source: 'toolbar', expectedRevision: engine.revision, operations: [{ type: 'text.findReplace', query: 'café', replacement: '已替换 👩‍💻' }] }).ok).toBe(true);
  expect(findMatches(editor.state.doc, 'café')).toHaveLength(0);
  expect(findMatches(editor.state.doc, '已替换 👩‍💻')).toHaveLength(2500);
  engine.history('undo'); expect(editor.getJSON()).toEqual(beforeReplace);
  expect(findMatches(editor.state.doc, 'café')).toHaveLength(2500);
  expect(editor.getJSON()).not.toEqual(baseline);
  console.info(`SEARCH_PROFILE median=${durations.sort((a,b)=>a-b)[6].toFixed(2)}ms max=${Math.max(...durations).toFixed(2)}ms, 2500 mixed paragraphs, 12 local edits`);
}, 30000);

async function open(content: string) {
  editor = new Editor({ extensions: createExtensions(), content });
  await new Promise(resolve => setTimeout(resolve, 0)); engine = new DocumentEngine(editor);
  return editor;
}
it('does not reuse results when the query, case option or whole-word option changes', async () => {
  const current = await open('<p>Café café CAFÉ cafétéria TARGET TARGETED target</p>');
  expect(findMatches(current.state.doc, 'café')).toHaveLength(4);
  expect(findMatches(current.state.doc, 'café', false, true)).toHaveLength(3);
  expect(findMatches(current.state.doc, 'Café', true, true)).toHaveLength(1);
  expect(findMatches(current.state.doc, 'café', true, true)).toHaveLength(1);
  expect(findMatches(current.state.doc, 'TARGET')).toHaveLength(3);
  expect(findMatches(current.state.doc, 'TARGET', false, true)).toHaveLength(2);
  expect(findMatches(current.state.doc, 'TARGET', true, true)).toHaveLength(1);
  expect(findMatches(current.state.doc, 'absent')).toEqual([]);
});
it('uses current positions when previously searched paragraphs move inside a merged table', async () => {
  const current = await open('<p>Outside café</p><table><tr><td rowspan="2"><p>Cell café</p></td><td><p>العربية</p></td></tr><tr><td><p>Last café</p></td></tr></table>');
  const baseline = current.getJSON(), before = findMatches(current.state.doc, 'café'); expect(before).toHaveLength(3);
  const first = current.state.doc.firstChild!, table = current.state.doc.child(1);
  current.view.dispatch(current.state.tr.delete(first.nodeSize, first.nodeSize + table.nodeSize).insert(0, table));
  const moved = findMatches(current.state.doc, 'café'); expect(moved).toHaveLength(3); expect(moved).not.toEqual(before);
  expect(moved.map(match => current.state.doc.textBetween(match.from, match.to))).toEqual(['café', 'café', 'café']);
  expect(engine!.execute({ source: 'toolbar', expectedRevision: engine!.revision, operations: [{ type: 'text.findReplace', query: 'café', replacement: '変更 👩‍💻' }] }).ok).toBe(true);
  expect(findMatches(current.state.doc, '変更 👩‍💻')).toHaveLength(3);
  engine!.history('undo'); expect(findMatches(current.state.doc, 'café')).toEqual(moved);
  engine!.history('undo'); expect(current.getJSON()).toEqual(baseline); expect(findMatches(current.state.doc, 'café')).toEqual(before);
});
it('invalidates equal-length text edits and follows undo and redo without reusing a stale match', async () => {
  const current = await open('<p>LEFT keep RIGHT</p>'); const baseline = current.getJSON();
  const match = findMatches(current.state.doc, 'LEFT')[0];
  expect(engine!.execute({ source: 'toolbar', expectedRevision: engine!.revision, target: { kind: 'range', ...match }, operations: [{ type: 'text.replace', text: 'NEXT' }] }).ok).toBe(true);
  expect(findMatches(current.state.doc, 'LEFT')).toEqual([]); expect(findMatches(current.state.doc, 'NEXT')).toEqual([match]);
  engine!.history('undo'); expect(current.getJSON()).toEqual(baseline); expect(findMatches(current.state.doc, 'LEFT')).toEqual([match]);
  engine!.history('redo'); expect(findMatches(current.state.doc, 'LEFT')).toEqual([]); expect(findMatches(current.state.doc, 'NEXT')).toEqual([match]);
});
it('keeps composed-character ranges across marks and does not search through inline objects', async () => {
  const current = await open('<p><strong>cafe</strong><em>́</em><br>café</p>');
  const baseline = current.getJSON();
  for (let i = 0; i < 3; i++) {
    const matches = findMatches(current.state.doc, 'café'); expect(matches).toHaveLength(2);
    expect(matches.map(match => current.state.doc.textBetween(match.from, match.to))).toEqual(['café', 'café']);
    expect(findMatches(current.state.doc, 'cafécafé')).toEqual([]);
    expect(findMatches(current.state.doc, 'caf')).toHaveLength(2);
    expect(findMatches(current.state.doc, 'cafe')).toEqual([]);
  }
  expect(engine!.execute({ source: 'toolbar', expectedRevision: engine!.revision, operations: [{ type: 'text.findReplace', query: 'café', replacement: '中文' }] }).ok).toBe(true);
  expect(current.state.doc.firstChild!.childCount).toBe(3);
  expect(current.state.doc.firstChild!.child(1).type.name).toBe('hardBreak');
  engine!.history('undo'); expect(current.getJSON()).toEqual(baseline);
});
