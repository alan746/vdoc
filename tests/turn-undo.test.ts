import { afterEach, beforeEach, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { undoDepth } from '@tiptap/pm/history';
import { createExtensions } from '../lib/editor/extensions';
import { DocumentEngine } from '../lib/usecases/engine';
import { documentNavigation } from '../lib/usecases/document-navigation';

let editor: Editor, engine: DocumentEngine;
beforeEach(async () => {
  editor = new Editor({ extensions: createExtensions(), content: '<p>hello</p><p>second</p><table><tr><td>A</td><td>B</td></tr></table>' });
  await new Promise(resolve => setTimeout(resolve, 0));
  engine = new DocumentEngine(editor);
});
afterEach(() => { engine.destroy(); editor.destroy(); });
const origin = (turnId: string) => ({ actor: 'assistant', turnId });
const edit = (turnId: string, start: number, end: number, text: string, index = 0) => {
  const s = engine.snapshot(), block = s.blocks[index];
  return engine.executeAgent({ expectedSessionId: s.sessionId, expectedRevision: s.revision, target: { kind: 'text', blockId: block.id, start, end }, operations: [{ type: 'text.replace', text }] }, origin(turnId));
};
const type = (offset: number, text: string, index = 0) => {
  editor.commands.setTextSelection(engine.snapshot().blocks[index].from + offset);
  editor.commands.insertContent(text);
};
const paragraph = (index = 0) => engine.snapshot().blocks[index].text;

it('excludes agent changes from native undo and redo while preserving ordinary user history', () => {
  type(5, '!');
  expect(edit('a', 0, 6, 'AI', 1).ok).toBe(true);
  expect(engine.history('undo', 'keyboard').ok).toBe(true);
  expect(paragraph()).toBe('hello'); expect(paragraph(1)).toBe('AI');
  expect(engine.history('redo', 'api').ok).toBe(true);
  expect(paragraph()).toBe('hello!'); expect(paragraph(1)).toBe('AI');
});

it('does not add a native undo event when only the agent edits', () => {
  const baseline = undoDepth(editor.state);
  expect(edit('a', 0, 5, 'AI').ok).toBe(true);
  expect(undoDepth(editor.state)).toBe(baseline);
  engine.history('undo');
  expect(paragraph()).toBe('AI');
});

it('keeps an agent insertion inside earlier user typing when native undo is used', () => {
  type(5, '123');
  expect(edit('a', 6, 6, 'X').ok).toBe(true);
  expect(engine.history('undo', 'keyboard').ok).toBe(true);
  expect(paragraph()).toBe('helloX');
  expect(engine.history('redo', 'keyboard').ok).toBe(true);
  expect(paragraph()).toBe('hello1X23');
  expect(engine.history('undo', 'keyboard').ok).toBe(true);
  expect(engine.undoTurn('a', origin('undo-a')).ok).toBe(true);
  expect(paragraph()).toBe('hello');
});

it('keeps native typing grouped when it has no agent changes', () => {
  type(5, '1'); type(6, '2'); type(7, '3');
  expect(engine.history('undo', 'api').ok).toBe(true); expect(paragraph()).toBe('hello');
  expect(engine.history('redo', 'api').ok).toBe(true); expect(paragraph()).toBe('hello123');
});

it('refuses to destroy later input in a newly inserted table', () => {
  const s = engine.snapshot();
  expect(engine.executeAgent({ expectedSessionId: s.sessionId, expectedRevision: s.revision, target: { kind: 'text', blockId: s.blocks[0].id, start: 5, end: 5 }, operations: [{ type: 'table.insert', rows: 1, cols: 1, header: false }] }, origin('a')).ok).toBe(true);
  let cellPosition = 0;
  editor.state.doc.descendants((node, pos) => { if (!cellPosition && node.type.name === 'tableCell') cellPosition = pos + 2; });
  editor.commands.setTextSelection(cellPosition); editor.commands.insertContent('keep this');
  const before = editor.getJSON();
  expect(engine.undoTurn('a', origin('undo-a')).ok).toBe(false);
  expect(editor.getJSON()).toEqual(before);
});

it.each([0, 2, 8])('preserves later user input at offset %s around an agent insertion', offset => {
  expect(edit('a', 1, 1, 'ABC').ok).toBe(true);
  type(offset, '!');
  expect(engine.undoTurn('a', origin('undo-a')).ok).toBe(true);
  expect(paragraph()).toBe(offset === 0 ? '!hello' : offset === 8 ? 'hello!' : 'h!ello');
  expect(engine.history('undo', 'api').ok).toBe(true);
  expect(paragraph()).toBe('hello');
});

it('restores replaced text while retaining later input inside the replacement', () => {
  expect(edit('a', 0, 5, 'world').ok).toBe(true);
  type(2, '!');
  expect(engine.undoTurn('a', origin('undo-a')).ok).toBe(true);
  expect(paragraph()).toBe('hello!');
  expect(engine.history('undo', 'api').ok).toBe(true);
  expect(paragraph()).toBe('hello');
});

it('reverses every request in a turn, including repeated replacements of the same range', () => {
  expect(edit('a', 0, 5, 'one').ok).toBe(true);
  expect(edit('a', 0, 3, 'two').ok).toBe(true);
  expect(edit('a', 0, 6, 'third', 1).ok).toBe(true);
  expect(engine.undoTurn('a', origin('undo-a')).ok).toBe(true);
  expect(paragraph()).toBe('hello'); expect(paragraph(1)).toBe('second');
});

it('rebases over another agent turn without undoing it', () => {
  expect(edit('a', 1, 1, 'ABC').ok).toBe(true);
  expect(edit('b', 2, 2, '!').ok).toBe(true);
  expect(engine.undoTurn('a', origin('undo-a')).ok).toBe(true);
  expect(paragraph()).toBe('h!ello');
  expect(engine.undoTurn('b', origin('undo-b')).ok).toBe(true);
  expect(paragraph()).toBe('hello');
});

it('undoes an undo as a new turn and supports repeated alternating undo', () => {
  expect(edit('a', 1, 1, 'ABC').ok).toBe(true);
  type(2, '!');
  const withAgent = editor.getJSON();
  expect(engine.undoTurn('a', origin('undo-a')).ok).toBe(true);
  expect(engine.undoTurn('a', origin('duplicate')).ok).toBe(false);
  expect(engine.undoTurn('undo-a', origin('restore-a')).ok).toBe(true);
  expect(editor.getJSON()).toEqual(withAgent);
  expect(engine.undoTurn('restore-a', origin('undo-restore')).ok).toBe(true);
  expect(paragraph()).toBe('h!ello');
});

it.each(['list', 'table'] as const)('undoes %s changes over typing in another block', kind => {
  const s = engine.snapshot(), table = s.tables[0];
  const input = { expectedSessionId: s.sessionId, expectedRevision: s.revision,
    target: kind === 'list' ? { kind: 'block', id: s.blocks[0].id } : { kind: 'cell', tableId: table.id, cellId: table.cells[0].id },
    operations: kind === 'list' ? [{ type: 'list.toggle', kind: 'bullet' }] : [{ type: 'table.edit', action: 'rowAfter' }] };
  expect(engine.executeAgent(input, origin('a')).ok).toBe(true);
  type(6, '!', 1);
  expect(engine.undoTurn('a', origin('undo-a')).ok).toBe(true);
  expect(paragraph(1)).toBe('second!');
  expect(editor.state.doc.firstChild?.type.name).toBe('paragraph');
  expect(engine.snapshot().tables[0].rows).toBe(1);
});

it('preserves typing inside a list while undoing its wrapper', () => {
  const s = engine.snapshot();
  expect(engine.executeAgent({ expectedSessionId: s.sessionId, expectedRevision: s.revision, target: { kind: 'block', id: s.blocks[0].id }, operations: [{ type: 'list.toggle', kind: 'bullet' }] }, origin('a')).ok).toBe(true);
  type(2, '!');
  expect(engine.undoTurn('a', origin('undo-a')).ok).toBe(true);
  expect(paragraph()).toBe('he!llo');
  expect(editor.state.doc.firstChild?.type.name).toBe('paragraph');
});

it('emits one applied event and tags the undo with its new origin without moving the caret', () => {
  expect(edit('a', 0, 5, 'AI').ok).toBe(true);
  editor.commands.setTextSelection(engine.snapshot().blocks[1].from + 3);
  const events: unknown[] = [];
  engine.onApplied(event => events.push(event));
  const result = engine.undoTurn('a', origin('undo-a'));
  expect(result.ok).toBe(true);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ source: 'agent', actor: 'assistant', turnId: 'undo-a', revision: result.revision, documentChanged: true });
  expect(engine.records[0]).toMatchObject({ source: 'agent', turnId: 'undo-a' });
  expect(editor.state.selection.$from.parentOffset).toBe(3);
  expect(editor.state.selection.$from.parent.textContent).toBe('second');
});

it('fails without changing state for unknown, reused or already-removed turns', () => {
  const initial = editor.getJSON();
  expect(engine.undoTurn('missing', origin('u')).ok).toBe(false);
  expect(editor.getJSON()).toEqual(initial);
  expect(edit('a', 1, 1, 'ABC').ok).toBe(true);
  expect(engine.undoTurn('a', origin('a')).ok).toBe(false);
  editor.commands.deleteRange({ from: 2, to: 5 });
  const before = editor.getJSON();
  expect(engine.undoTurn('a', origin('u')).ok).toBe(false);
  expect(editor.getJSON()).toEqual(before);
});

it('refuses an evicted or partially evicted turn instead of undoing only its retained tail', () => {
  engine.destroy(); engine = new DocumentEngine(editor, { undoStepLimit: 3 });
  expect(edit('a', 0, 0, 'A').ok).toBe(true);
  expect(edit('a', 0, 0, 'B').ok).toBe(true);
  type(0, '1'); type(0, '2');
  const before = editor.getJSON();
  expect(engine.undoTurn('a', origin('u')).ok).toBe(false);
  expect(editor.getJSON()).toEqual(before);
});

it('keeps a newer document attribute value', () => {
  const s = engine.snapshot();
  expect(engine.executeAgent({ expectedSessionId: s.sessionId, expectedRevision: s.revision, target: { kind: 'block', id: s.blocks[0].id }, operations: [{ type: 'document.language', language: 'fr' }] }, origin('a')).ok).toBe(true);
  engine.execute({ operations: [{ type: 'document.language', language: 'de' }] });
  expect(engine.undoTurn('a', origin('u')).ok).toBe(false);
  expect(editor.state.doc.attrs.language).toBe('de');
});

it('restores only the paragraph attributes that have not been overwritten later', () => {
  const s = engine.snapshot(), target = { kind: 'block', id: s.blocks[0].id };
  const originalSpacing = editor.state.doc.firstChild?.attrs.spaceBefore;
  expect(engine.executeAgent({ expectedSessionId: s.sessionId, expectedRevision: s.revision, target, operations: [{ type: 'paragraph.style', align: 'center', spaceBefore: 10 }] }, origin('a')).ok).toBe(true);
  engine.execute({ target, operations: [{ type: 'paragraph.style', align: 'right' }] });
  expect(engine.undoTurn('a', origin('u')).ok).toBe(true);
  expect(editor.state.doc.firstChild?.attrs.textAlign).toBe('right');
  expect(editor.state.doc.firstChild?.attrs.spaceBefore).toBe(originalSpacing);
});

it('does not overwrite a newer text color when undoing an agent clear-format request', () => {
  const s = engine.snapshot(), target = { kind: 'block', id: s.blocks[0].id };
  engine.execute({ target, operations: [{ type: 'text.style', style: { bold: true, color: '#FF0000' } }] });
  expect(engine.executeAgent({ expectedSessionId: s.sessionId, expectedRevision: engine.revision, target, operations: [{ type: 'text.clear' }] }, origin('a')).ok).toBe(true);
  engine.execute({ target, operations: [{ type: 'text.style', style: { color: '#0000FF' } }] });
  expect(engine.undoTurn('a', origin('u')).ok).toBe(true);
  expect(editor.getHTML()).toContain('<strong>');
  expect(editor.state.doc.firstChild?.firstChild?.marks.find(mark => mark.type.name === 'textStyle')?.attrs.color).toBe('#0000FF');
});

it('checks composition and lifecycle before preparing an undo', () => {
  expect(edit('a', 0, 5, 'AI').ok).toBe(true);
  const before = editor.getJSON(), release = documentNavigation(editor).registerCompositionGuard(() => true);
  expect(engine.undoTurn('a', origin('u')).code).toBe('COMPOSING');
  expect(editor.getJSON()).toEqual(before); release();
  engine.destroy(); expect(engine.undoTurn('a', origin('u')).code).toBe('UNAVAILABLE');
});
