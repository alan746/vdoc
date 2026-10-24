import { afterEach, beforeEach, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { createExtensions } from '../lib/editor/extensions';
import { attachStreamingDraft } from '../lib/editor/realtime/streaming-draft';
import type { StreamDraft } from '../lib/usecases/ports';

let editor: Editor, draft: ReturnType<typeof attachStreamingDraft>;
beforeEach(async () => {
  editor = new Editor({ extensions: createExtensions(), content: '<p>first</p><p>second</p>' });
  await new Promise(resolve => setTimeout(resolve, 0));
  draft = attachStreamingDraft(editor);
});
afterEach(() => { draft.dispose(); editor.destroy(); });
const show = (anchor: StreamDraft['anchor']) => draft.receive({ type: 'preview', callId: 'a', phase: 'streaming', text: '新文字', drafts: [{ text: '新文字', anchor }] });
it('places a streamed paragraph between the requested blocks without moving the selection or saving it', () => {
  const first = editor.state.doc.firstChild!.attrs.blockId, before = editor.getJSON(), selection = editor.state.selection;
  show({ kind: 'after_block', blockId: first });
  const widget = editor.view.dom.querySelector('.vdoc-streaming-draft')!;
  expect(widget.previousElementSibling?.textContent).toBe('first');
  expect(widget.nextElementSibling?.textContent).toBe('second');
  expect(editor.state.selection.eq(selection)).toBe(true);
  expect(editor.getJSON()).toEqual(before); expect(editor.getHTML()).not.toContain('新文字');
});
it('places continuation text inside its paragraph and rejects missing anchors and invalid offsets', () => {
  const first = editor.state.doc.firstChild!.attrs.blockId;
  show({ kind: 'text', blockId: first, offset: 3 });
  const widget = editor.view.dom.querySelector('.vdoc-streaming-draft')!;
  expect(widget.parentElement?.tagName).toBe('P');
  expect(widget.previousSibling?.textContent).toBe('fir');
  expect(widget.nextSibling?.textContent).toBe('st');
  for (const anchor of [{ kind: 'after_block', blockId: 'missing' }, { kind: 'text', blockId: first, offset: 999 }, { kind: 'position', pos: -1 }] as const) {
    show(anchor); expect(editor.view.dom.querySelector('.vdoc-streaming-draft')).toBeNull();
  }
});
it('unregisters the view plugin and remains inert after disposal', () => {
  const count = editor.state.plugins.length;
  show({ kind: 'document_end' }); draft.dispose();
  expect(editor.state.plugins.length).toBe(count - 1);
  expect(editor.view.dom.querySelector('.vdoc-streaming-draft')).toBeNull();
  show({ kind: 'document_end' });
  expect(editor.view.dom.querySelector('.vdoc-streaming-draft')).toBeNull();
});
it('renders streamed blocks with the markup the committed edit will have', () => {
  draft.receive({ type: 'preview', callId: 'a', phase: 'streaming', text: '', drafts: [
    { text: 'Title', anchor: { kind: 'document_end' }, block: { kind: 'heading', level: 1 } },
    { text: 'Section', anchor: { kind: 'document_end' }, block: { kind: 'heading', level: 2 } },
    { text: 'Body', anchor: { kind: 'document_end' }, block: { kind: 'paragraph' } },
    { text: 'A ｜ B', anchor: { kind: 'document_end' }, block: { kind: 'table', header: true, rows: [['A', 'B']] } },
  ] });
  const widget = editor.view.dom.querySelector('.vdoc-streaming-draft')!;
  expect([...widget.children].map(child => child.tagName)).toEqual(['H1', 'H2', 'P', 'TABLE']);
  expect(widget.querySelector('th')?.textContent).toBe('A');
  expect(editor.getHTML()).not.toContain('Section');
});
it('adds a paragraph anchored on a list item to that list', () => {
  editor.commands.setContent('<ul><li><p>one</p></li></ul>');
  const item = editor.state.doc.firstChild!.firstChild!.firstChild!.attrs.blockId;
  draft.receive({ type: 'preview', callId: 'b', phase: 'streaming', text: 'two', drafts: [{ text: 'two', anchor: { kind: 'after_block', blockId: item }, block: { kind: 'paragraph' } }] });
  const widget = editor.view.dom.querySelector('.vdoc-streaming-draft')!;
  expect(widget.parentElement?.tagName).toBe('UL');
  expect(widget.firstElementChild?.tagName).toBe('LI');
  expect(widget.textContent).toBe('two');
});
it('hides a blank document\'s empty paragraph while an article that replaces it streams', () => {
  editor.commands.setContent('<p></p>');
  const article = (replacesBlankDocument: boolean) => draft.receive({ type: 'preview', callId: 'c', phase: 'streaming', text: 'Title', replacesBlankDocument,
    drafts: [{ text: 'Title', anchor: { kind: 'document_end' }, block: { kind: 'heading', level: 1 } }] });
  article(true);
  expect(editor.view.dom.querySelector('p.vdoc-streaming-replaced')).not.toBeNull();
  article(false);
  expect(editor.view.dom.querySelector('.vdoc-streaming-replaced')).toBeNull();
});
