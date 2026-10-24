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
