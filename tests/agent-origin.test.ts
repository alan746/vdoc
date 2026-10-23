import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { createExtensions } from '../lib/editor/extensions';
import { DocumentEngine } from '../lib/usecases/engine';

let editor: Editor, engine: DocumentEngine;
const origin = { actor: 'agent-1', turnId: 'turn-1' };
beforeEach(async () => {
  const el = document.createElement('div'); document.body.appendChild(el);
  editor = new Editor({ element: el, extensions: createExtensions(), content: '<p>Hello world</p><p>Second paragraph</p>' });
  await new Promise(resolve => setTimeout(resolve, 0));
  engine = new DocumentEngine(editor);
});
afterEach(() => { engine.destroy(); editor.destroy(); document.body.innerHTML = ''; vi.restoreAllMocks(); });

const blockRequest = (index: number, operations: unknown[]) => {
  const s = engine.snapshot();
  return { expectedSessionId: s.sessionId, expectedRevision: s.revision, target: { kind: 'block', id: s.blocks[index].id }, operations };
};
const caret = (pos: number) => editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)));

describe('agent origin', () => {
  it('edits another block without moving the user caret', () => {
    caret(3);
    expect(engine.executeAgent(blockRequest(1, [{ type: 'text.toggle', mark: 'bold' }]), origin).ok).toBe(true);
    expect(editor.getHTML()).toContain('<strong>Second paragraph</strong>');
    expect(editor.state.selection.from).toBe(3);
    expect(editor.state.selection.empty).toBe(true);
  });

  it('maps the user caret through an edit that shifts positions', () => {
    const second = engine.snapshot().blocks[1];
    caret(second.from + 6);
    expect(engine.executeAgent(blockRequest(0, [{ type: 'text.replace', text: 'Hi' }]), origin).ok).toBe(true);
    const { $from } = editor.state.selection;
    expect($from.parent.attrs.blockId).toBe(second.id);
    expect($from.parentOffset).toBe(6);
  });

  it('keeps the user selection range and pending stored marks', () => {
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 6)));
    expect(engine.executeAgent(blockRequest(1, [{ type: 'paragraph.style', align: 'center' }]), origin).ok).toBe(true);
    expect([editor.state.selection.from, editor.state.selection.to]).toEqual([1, 6]);
    caret(3);
    editor.commands.toggleBold();
    expect(editor.state.storedMarks?.map(mark => mark.type.name)).toEqual(['bold']);
    expect(engine.executeAgent(blockRequest(1, [{ type: 'text.toggle', mark: 'italic' }]), origin).ok).toBe(true);
    expect(editor.state.storedMarks?.map(mark => mark.type.name)).toEqual(['bold']);
  });

  it('does not focus the editor or discard the toolbar selection bookmark', () => {
    const focus = vi.spyOn(editor.view, 'focus');
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 6)));
    engine.captureSelection();
    caret(9);
    expect(engine.executeAgent(blockRequest(1, [{ type: 'text.toggle', mark: 'italic' }]), origin).ok).toBe(true);
    expect(focus).not.toHaveBeenCalled();
    expect(engine.execute({ source: 'toolbar', operations: [{ type: 'text.toggle', mark: 'bold' }] }).ok).toBe(true);
    expect(editor.getHTML()).toContain('<strong>Hello</strong> world');
  });

  it('tags the transaction and the history record with the actor and turn', () => {
    const metas: unknown[] = [];
    editor.on('transaction', ({ transaction }) => { if (transaction.getMeta('vdoc')) metas.push(transaction.getMeta('vdoc')); });
    const result = engine.executeAgent({ ...blockRequest(0, [{ type: 'text.toggle', mark: 'bold' }]), id: 'agent-op' }, origin);
    expect(result.ok).toBe(true);
    expect(metas).toEqual([{ id: 'agent-op', source: 'agent', actor: 'agent-1', turnId: 'turn-1' }]);
    expect(engine.records[0]).toMatchObject({ id: 'agent-op', source: 'agent', actor: 'agent-1', turnId: 'turn-1' });
  });

  it('returns the first result for an identical retry', () => {
    const input = { ...blockRequest(0, [{ type: 'text.insert', text: '!' }]), id: 'retry' };
    const first = engine.executeAgent(input, origin), html = editor.getHTML();
    expect(first.ok).toBe(true);
    expect(engine.executeAgent(input, origin)).toEqual(first);
    expect(editor.getHTML()).toBe(html);
  });

  it('keeps the agent origin out of reach of external callers', () => {
    const before = editor.getJSON();
    const request = blockRequest(0, [{ type: 'text.toggle', mark: 'bold' }]);
    expect(engine.executeExternal({ ...request, source: 'agent' }).code).toBe('INVALID');
    expect(engine.executeExternal({ ...request, actor: 'x' }).code).toBe('INVALID');
    expect(engine.executeExternal({ ...request, turnId: 'x' }).code).toBe('INVALID');
    expect(engine.executeAgent({ ...request, source: 'toolbar' }, origin).code).toBe('INVALID');
    expect(engine.executeAgent({ ...request, target: { kind: 'selection' } }, origin).code).toBe('INVALID');
    const { expectedSessionId: _, ...sessionless } = request;
    expect(engine.executeAgent(sessionless, origin).code).toBe('INVALID');
    expect(engine.execute({ ...request, source: 'agent' }).code).toBe('INVALID');
    expect(engine.execute({ ...request, source: 'agent', actor: 'a', turnId: 't', target: { kind: 'selection' } }).code).toBe('INVALID');
    expect(engine.execute({ ...request, source: 'api', actor: 'a' }).code).toBe('INVALID');
    expect(editor.getJSON()).toEqual(before);
  });
});
