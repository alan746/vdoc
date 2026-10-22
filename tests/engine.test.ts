import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { CellSelection } from '@tiptap/pm/tables';
import { createExtensions } from '../lib/editor/extensions';
import { DocumentEngine } from '../lib/usecases/engine';
import { readSavedDocument, saveDocument, STORAGE_KEY } from '../lib/infrastructure/persistence/storage';

let editor: Editor;
let engine: DocumentEngine;
beforeEach(async () => {
  const el = document.createElement('div'); document.body.appendChild(el);
  editor = new Editor({ element: el, extensions: createExtensions(), content: '<p>Hello world</p><p>Second paragraph</p>' });
  await new Promise(resolve => setTimeout(resolve, 0));
  engine = new DocumentEngine(editor);
});
afterEach(() => { engine.destroy(); editor.destroy(); document.body.innerHTML = ''; localStorage.clear(); vi.restoreAllMocks(); });
const range = (from = 1, to = 6) => ({ target: { kind: 'range', from, to }, expectedRevision: engine.revision });

describe('unified document operations', () => {
  it('applies a batch atomically and undoes it in one step, then redoes', () => {
    const before = editor.getJSON();
    const result = engine.execute({ ...range(), operations: [
      { type: 'text.style', style: { bold: true, underline: true } },
      { type: 'text.style', style: { highlight: '#FFF0AD' } },
    ] });
    expect(result.ok).toBe(true);
    expect(editor.getHTML()).toContain('<strong>');
    expect(editor.getHTML()).toContain('<u>');
    expect(editor.getHTML()).toContain('<mark');
    expect(engine.history('undo', 'api').ok).toBe(true);
    expect(editor.getJSON()).toEqual(before);
    expect(engine.history('redo', 'api').ok).toBe(true);
    expect(editor.getHTML()).toContain('<mark');
  });
  it('does not dispatch a partially valid batch', () => {
    const before = editor.getJSON(), revision = engine.revision;
    const result = engine.execute({ ...range(), operations: [
      { type: 'text.style', style: { bold: true } }, { type: 'table.edit', action: 'deleteRow' },
    ] });
    expect(result.ok).toBe(false);
    expect(editor.getJSON()).toEqual(before);
    expect(engine.revision).toBe(revision);
    expect(engine.canUndo).toBe(false);
  });
  it('rejects invalid colors, unknown fields and invalid targets before any edit', () => {
    const before = editor.getJSON();
    for (const request of [
      { operations: [{ type: 'text.style', style: { color: 'url(evil)' } }] },
      { operations: [{ type: 'text.toggle', mark: 'bold', bad: true }] },
      { ...range(10000, 10001), operations: [{ type: 'text.clear' }] },
      { target: { kind: 'block', id: 'missing' }, operations: [{ type: 'text.clear' }] },
    ]) expect(engine.execute(request).ok).toBe(false);
    expect(editor.getJSON()).toEqual(before);
  });
  it('rejects stale position requests and requires a revision for ranges', () => {
    const oldRevision = engine.revision;
    editor.commands.insertContent('a');
    expect(engine.execute({ ...range(), expectedRevision: oldRevision, operations: [{ type: 'text.clear' }] }).code).toBe('STALE');
    expect(engine.execute({ target: { kind: 'range', from: 1, to: 2 }, operations: [{ type: 'text.clear' }] }).code).toBe('STALE');
  });
  it('retries a command ID without repeating its insertion, and rejects ID reuse', () => {
    const request = { id: 'retry-1', operations: [{ type: 'text.insert', text: 'one' }] };
    const first = engine.execute(request);
    const before = editor.getJSON();
    expect(engine.execute(request)).toEqual(first);
    expect(editor.getJSON()).toEqual(before);
    expect(engine.execute({ ...request, operations: [{ type: 'text.insert', text: 'two' }] }).code).toBe('DUPLICATE');
  });
  it('keeps separate toolbar operations as separate undo steps', () => {
    engine.execute({ ...range(), operations: [{ type: 'text.style', style: { bold: true } }] });
    engine.execute({ ...range(), operations: [{ type: 'text.style', style: { underline: true } }] });
    engine.history('undo', 'api');
    expect(editor.getHTML()).toContain('<strong>');
    expect(editor.getHTML()).not.toContain('<u>');
    engine.history('undo', 'api');
    expect(editor.getHTML()).not.toContain('<strong>');
  });
  it('preserves a toolbar bookmark after a menu moves focus', () => {
    editor.commands.setTextSelection({ from: 1, to: 6 }); engine.captureSelection();
    editor.commands.setTextSelection({ from: 14, to: 20 });
    expect(engine.execute({ source: 'toolbar', operations: [{ type: 'text.style', style: { underline: true } }] }).ok).toBe(true);
    expect(editor.getHTML()).toContain('<u>Hello</u>');
  });
  it('discards a cancelled menu bookmark when the user selects elsewhere', () => {
    editor.commands.setTextSelection({ from: 1, to: 6 }); engine.captureSelection();
    editor.view.dom.dispatchEvent(new Event('pointerdown'));
    editor.commands.setTextSelection({ from: 14, to: 20 });
    engine.execute({ source: 'toolbar', operations: [{ type: 'text.style', style: { underline: true } }] });
    expect(editor.getHTML()).toContain('<u>Second</u>');
    expect(editor.getHTML()).not.toContain('<u>Hello</u>');
  });
  it('preserves stable IDs through heading changes and rejects empty styles', () => {
    const id = editor.state.doc.firstChild!.attrs.blockId;
    expect(engine.execute({ ...range(), operations: [{ type: 'paragraph.style', level: 2 }] }).ok).toBe(true);
    expect(editor.state.doc.firstChild!.attrs.blockId).toBe(id);
    expect(engine.execute({ operations: [{ type: 'paragraph.style' }] }).ok).toBe(false);
  });
  it('resolves a stable block ID after preceding text changes', () => {
    const secondId = editor.state.doc.child(1).attrs.blockId;
    editor.commands.insertContentAt(1, 'new ');
    expect(engine.execute({ target: { kind: 'block', id: secondId }, operations: [{ type: 'text.style', style: { italic: true } }] }).ok).toBe(true);
    expect(editor.getHTML()).toContain('<em>Second paragraph</em>');
  });
  it('treats API insertion as plain text rather than markup', () => {
    engine.execute({ operations: [{ type: 'text.insert', text: '<script>alert(1)</script>\nnext' }] });
    expect(editor.getText()).toContain('<script>alert(1)</script>');
    expect(editor.getHTML()).not.toContain('<script>');
    expect(editor.getHTML()).toContain('<br>');
  });
  it('applies heading and alignment in the same transaction', () => {
    const result = engine.execute({ ...range(), operations: [{ type: 'paragraph.style', level: 2, align: 'center', lineHeight: '2' }] });
    expect(result.ok).toBe(true);
    expect(editor.state.doc.firstChild?.type.name).toBe('heading');
    expect(editor.state.doc.firstChild?.attrs).toMatchObject({ level: 2, textAlign: 'center', lineHeight: '2' });
  });
  it('rejects commands during IME composition without altering content', () => {
    Object.defineProperty(editor.view, 'composing', { configurable: true, value: true });
    const before = editor.getJSON();
    expect(engine.execute({ operations: [{ type: 'text.insert', text: 'bad' }] }).code).toBe('COMPOSING');
    expect(editor.getJSON()).toEqual(before);
  });
  it('assigns unique block IDs when content is copied', () => {
    editor.commands.insertContentAt(editor.state.doc.content.size, editor.getJSON().content![0]);
    const ids = engine.snapshot().blocks.map(b => b.id);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('preserves the original block identity when a copy is inserted before it', () => {
    const original = editor.getJSON().content![0];
    editor.commands.insertContentAt(0, original);
    expect(editor.state.doc.child(1).attrs.blockId).toBe(original.attrs!.blockId);
    expect(editor.state.doc.child(0).attrs.blockId).not.toBe(original.attrs!.blockId);
  });
});

describe('font and highlight formatting', () => {
  it('combines font, size, color and highlight only on the selected text and restores them from storage', () => {
    expect(engine.execute({ ...range(), operations: [{ type: 'text.style', style: {
      fontFamily: 'Georgia', fontSize: 24, color: '#E65656', highlight: '#D8EFDE', underline: true,
    } }] }).ok).toBe(true);
    const content = editor.getJSON();
    expect(content.content![0].content).toEqual([
      { type: 'text', text: 'Hello', marks: expect.arrayContaining([
        { type: 'textStyle', attrs: expect.objectContaining({ fontFamily: 'Georgia', fontSize: '24px', color: '#E65656' }) },
        { type: 'highlight', attrs: { color: '#D8EFDE' } }, { type: 'underline' },
      ]) },
      { type: 'text', text: ' world' },
    ]);
    saveDocument('Styled document', content);
    const restored = new Editor({ extensions: createExtensions(), content: readSavedDocument().data!.content });
    try {
      expect(restored.getJSON()).toEqual(content);
      expect(restored.getHTML()).toContain('font-family: Georgia');
      expect(restored.getHTML()).toContain('font-size: 24px');
      expect(restored.getHTML()).toContain('background-color: rgb(216, 239, 222)');
    } finally { restored.destroy(); }
  });
  it('clears highlighting independently, clears all text formatting, and undoes both exactly', () => {
    engine.execute({ ...range(), operations: [{ type: 'text.style', style: {
      fontFamily: 'Times New Roman', fontSize: 32, color: '#4485D1', highlight: '#FFF0AD', bold: true,
    } }] });
    const styled = editor.getJSON();
    expect(engine.execute({ ...range(), operations: [{ type: 'text.style', style: { highlight: null } }] }).ok).toBe(true);
    expect(editor.getHTML()).not.toContain('<mark');
    expect(editor.getAttributes('textStyle')).toMatchObject({ fontFamily: 'Times New Roman', fontSize: '32px', color: '#4485D1' });
    expect(editor.isActive('bold')).toBe(true);
    engine.history('undo', 'api');
    expect(editor.getJSON()).toEqual(styled);
    expect(engine.execute({ ...range(), operations: [{ type: 'text.clear' }] }).ok).toBe(true);
    expect(editor.getJSON().content![0].content).toEqual([{ type: 'text', text: 'Hello world' }]);
    engine.history('undo', 'api');
    expect(editor.getJSON()).toEqual(styled);
  });
  it('uses font and highlight selected at the caret for subsequent typing, and can turn highlight off', () => {
    editor.commands.setTextSelection(6);
    expect(engine.execute({ operations: [{ type: 'text.style', style: { fontFamily: 'Georgia', fontSize: 20, highlight: '#FFF0AD' } }] }).ok).toBe(true);
    editor.view.dispatch(editor.state.tr.insertText('!'));
    const typed = editor.getJSON().content![0].content!.find(node => 'text' in node && node.text === '!');
    expect(typed?.marks).toEqual(expect.arrayContaining([
      { type: 'textStyle', attrs: expect.objectContaining({ fontFamily: 'Georgia', fontSize: '20px' }) },
      { type: 'highlight', attrs: { color: '#FFF0AD' } },
    ]));
    engine.execute({ operations: [{ type: 'text.style', style: { highlight: null } }] });
    editor.view.dispatch(editor.state.tr.insertText('?'));
    const plain = editor.getJSON().content![0].content!.find(node => 'text' in node && node.text === '?');
    expect(plain?.marks?.some(mark => mark.type === 'highlight')).toBe(false);
    expect(plain?.marks).toEqual(expect.arrayContaining([
      { type: 'textStyle', attrs: expect.objectContaining({ fontFamily: 'Georgia', fontSize: '20px' }) },
    ]));
  });
});

describe('table transactions', () => {
  it('inserts, adds a row, colors cells and undoes structural changes', () => {
    expect(engine.execute({ operations: [{ type: 'table.insert', rows: 2, cols: 2, header: true }] }).ok).toBe(true);
    expect(engine.execute({ operations: [{ type: 'table.edit', action: 'rowAfter' }] }).ok).toBe(true);
    let table = editor.state.doc.firstChild!;
    expect(table.type.name).toBe('table'); expect(table.childCount).toBe(3);
    expect(engine.execute({ operations: [{ type: 'table.background', color: '#FFF0AD' }] }).ok).toBe(true);
    expect(editor.getHTML()).toContain('background-color: rgb(255, 240, 173)');
    engine.history('undo', 'api'); engine.history('undo', 'api');
    table = editor.state.doc.firstChild!; expect(table.childCount).toBe(2);
  });
  it('merges and splits a cell selection', () => {
    engine.execute({ operations: [{ type: 'table.insert', rows: 2, cols: 2, header: true }] });
    const cells: number[] = [];
    editor.state.doc.descendants((node, pos) => { if (node.type.name === 'tableHeader') cells.push(pos); });
    editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc, cells[0], cells[1])));
    expect(engine.execute({ operations: [{ type: 'table.edit', action: 'merge' }] }).ok).toBe(true);
    expect(editor.state.doc.firstChild?.firstChild?.firstChild?.attrs.colspan).toBe(2);
    expect(engine.execute({ operations: [{ type: 'table.edit', action: 'split' }] }).ok).toBe(true);
    expect(editor.state.doc.firstChild?.firstChild?.childCount).toBe(2);
  });
});

describe('local persistence', () => {
  it('does not rewrite an unchanged document and trigger spurious cross-tab conflicts', () => {
    const saved = saveDocument('test', editor.getJSON());
    const write = vi.spyOn(Storage.prototype, 'setItem');
    expect(saveDocument('test', editor.getJSON())).toEqual(saved);
    expect(write).not.toHaveBeenCalled();
  });
  it('round trips structured content and title', () => {
    saveDocument('测试项目', editor.getJSON());
    const restored = readSavedDocument();
    expect(restored.error).toBeUndefined();
    expect(restored.data?.title).toBe('测试项目');
    expect(restored.data?.content).toEqual(editor.getJSON());
  });
  it('does not overwrite a damaged or incompatible saved document', () => {
    for (const raw of ['{invalid', JSON.stringify({ version: 99, title: 'future', content: { type: 'doc' } })]) {
      localStorage.setItem(STORAGE_KEY, raw);
      expect(readSavedDocument().error).toBeDefined();
      expect(localStorage.getItem(STORAGE_KEY)).toBe(raw);
    }
  });
});
