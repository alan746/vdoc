import { selectedParagraphs } from '../lib/editor/paragraph-selection';
import { beforeEach, afterEach, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import { createExtensions } from '../lib/editor/extensions';
import { DocumentEngine } from '../lib/editor/engine';
import { paragraphIndent } from '../lib/editor/paragraph-indent';
import { selectedIndent } from '../lib/editor/paragraph-indent';
import { selectedPagination } from '../lib/editor/paragraph-pagination';
import { rulerDeltaBounds, rulerPointerDelta } from '../lib/editor/paragraph-ruler';
let editor: Editor, engine: DocumentEngine;
beforeEach(async () => {
  editor = new Editor({ extensions: createExtensions(), content: '<p data-indent-start="12.5" data-first-line-indent="24">English 中文</p><p dir="rtl" data-indent-start="37.5" data-first-line-indent="-36">العربية עברית</p>' });
  await new Promise(r => setTimeout(r, 0)); engine = new DocumentEngine(editor); editor.commands.selectAll();
});
afterEach(() => { engine.destroy(); editor.destroy(); });
it('moves mixed paragraphs together without flattening their first-line offsets; exact one-step undo', () => {
  const before = editor.getJSON();
  expect(engine.execute({ operations: [{ type: 'paragraph.adjustIndent', handle: 'start', delta: 13.25 }] }).ok).toBe(true);
  expect(paragraphIndent(editor.state.doc.child(0).attrs)).toEqual({ indentStart: 25.75, indentEnd: 0, firstLineIndent: 24 });
  expect(paragraphIndent(editor.state.doc.child(1).attrs)).toEqual({ indentStart: 50.75, indentEnd: 0, firstLineIndent: -36 });
  const after = editor.getJSON(); engine.history('undo'); expect(editor.getJSON()).toEqual(before); engine.history('redo'); expect(editor.getJSON()).toEqual(after);
});
it('crosses from first-line to hanging indent without moving other lines or end margins', () => {
  engine.execute({ operations: [{ type: 'paragraph.adjustIndent', handle: 'firstLine', delta: -30 }] });
  expect(paragraphIndent(editor.state.doc.child(0).attrs)).toEqual({ indentStart: 6.5, indentEnd: 0, firstLineIndent: -6 });
  expect(paragraphIndent(editor.state.doc.child(1).attrs)).toEqual({ indentStart: 7.5, indentEnd: 0, firstLineIndent: -66 });
  engine.execute({ operations: [{ type: 'paragraph.adjustIndent', handle: 'firstLine', delta: 30 }] });
  expect(paragraphIndent(editor.state.doc.child(0).attrs)).toEqual({ indentStart: 12.5, indentEnd: 0, firstLineIndent: 24 });
  expect(paragraphIndent(editor.state.doc.child(1).attrs)).toEqual({ indentStart: 37.5, indentEnd: 0, firstLineIndent: -36 });
});
it('limits each column selection to its cells, excluding intervening cells', () => {
  editor.commands.setContent('<table><tr><td><p>A</p></td><td><p>B</p></td></tr><tr><td><p>C</p></td><td><p>D</p></td></tr></table>');
  const table = editor.state.doc.firstChild!, map = TableMap.get(table);
  editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc, 1 + map.map[0], 1 + map.map[2])));
  expect(selectedParagraphs(editor.state.doc, editor.state.selection).map(p => p.node.textContent)).toEqual(['A', 'C']);
  const before = editor.getJSON();
  engine.execute({ operations: [{ type: 'paragraph.adjustIndent', handle: 'end', delta: 12 }] });
  const ends: Record<string, number> = {};
  editor.state.doc.descendants(n => { if (n.type.name === 'paragraph') ends[n.textContent] = n.attrs.indentEnd; });
  expect(ends).toMatchObject({ A: 12, B: 0, C: 12, D: 0 });
  editor.state.doc.descendants(n => { if (n.type.name === 'paragraph') expect(n.attrs.indentStart).toBeNull(); });
  engine.history('undo'); expect(editor.getJSON()).toEqual(before);
});
it('rejects an overflowing result atomically even if an earlier paragraph was valid', () => {
  const before = editor.getJSON(), revision = engine.revision;
  expect(engine.execute({ operations: [{ type: 'paragraph.adjustIndent', handle: 'start', delta: 9980 }] }).ok).toBe(false);
  expect(editor.getJSON()).toEqual(before); expect(engine.revision).toBe(revision);
});
it('reads and applies paragraph layout across every selected cell, with mixed values and exact Undo', () => {
  editor.commands.setContent('<table><tr><td><h2 data-indent-start="12" data-keep-lines-together="true">A</h2></td><td><p>B</p></td></tr><tr><td><p data-indent-start="24">C</p></td><td><p>D</p></td></tr></table>');
  const map = TableMap.get(editor.state.doc.firstChild!);
  editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc, 1 + map.map[0], 1 + map.map[2])));
  expect(selectedIndent(editor).indentStart).toBeNull(); expect(selectedPagination(editor).keepLinesTogether).toBe('mixed');
  const before = editor.getJSON();
  engine.execute({ operations: [{ type: 'paragraph.style', spaceBefore: 20, keepLinesTogether: true, lineHeight: '2' }, { type: 'paragraph.indent', direction: 'in' }] });
  const result: Record<string, any> = {}; editor.state.doc.descendants(n => { if (['paragraph', 'heading'].includes(n.type.name)) result[n.textContent] = n.attrs; });
  expect(result.A).toMatchObject({ indentStart: 36, spaceBefore: 20, keepLinesTogether: true, lineHeight: '2' });
  expect(result.C).toMatchObject({ indentStart: 48, spaceBefore: 20, keepLinesTogether: true, lineHeight: '2' });
  expect(result.B).toMatchObject({ indentStart: null, spaceBefore: null, keepLinesTogether: false });
  expect(result.D).toMatchObject({ indentStart: null, spaceBefore: null, keepLinesTogether: false });
  engine.history('undo'); expect(editor.getJSON()).toEqual(before);
});
it('rejects stale ruler commands after text changes and preserves the newer edit', () => {
  const revision = engine.revision; engine.execute({ operations: [{ type: 'text.insert', text: 'Newer text' }] }); const before = editor.getJSON();
  expect(engine.execute({ expectedRevision: revision, operations: [{ type: 'paragraph.adjustIndent', handle: 'end', delta: 24 }] }).code).toBe('STALE');
  expect(editor.getJSON()).toEqual(before);
});
it.each([0.5, 0.75, 1, 1.25, 2])('converts physical pointer movement at %sx including RTL and the end marker', scale => {
  expect(rulerPointerDelta(24 * scale, scale, false, 'start')).toBe(24);
  expect(rulerPointerDelta(24 * scale, scale, true, 'firstLine')).toBe(-24);
  expect(rulerPointerDelta(24 * scale, scale, true, 'end')).toBe(24);
  expect(rulerPointerDelta(0.25 * scale, scale, false, 'start', true)).toBe(0.25);
});
it('reserves 24px of text in narrow cells and permits imported outdents to move back in', () => {
  expect(rulerDeltaBounds({ indentStart: 12, indentEnd: 10, firstLineIndent: -24 }, 100, 'start')).toEqual({ min: -12, max: 30 });
  expect(rulerDeltaBounds({ indentStart: 12, indentEnd: 10, firstLineIndent: -24 }, 100, 'firstLine')).toEqual({ min: -12, max: 54 });
  expect(rulerDeltaBounds({ indentStart: -24, indentEnd: 0, firstLineIndent: -24 }, 100, 'start')).toEqual({ min: 0, max: 76 });
});
