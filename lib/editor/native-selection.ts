import { Extension } from '@tiptap/core';
import { AllSelection, Plugin, TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

const navigationKeys = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);

// Browsers may defer selectionchange until after the next keyboard event.
// Read the browser's actual caret, preserving native bidi/grapheme movement,
// before an editing command can act on the previous selected text.
export function syncNativeTextSelection(view: EditorView) {
  if (!view.editable || view.composing || !view.hasFocus()) return;
  if (!(view.state.selection instanceof TextSelection) && !(view.state.selection instanceof AllSelection)) return;
  const selection = view.dom.ownerDocument.getSelection();
  if (!selection || selection.rangeCount !== 1 || !selection.anchorNode || !selection.focusNode) return;
  if (!view.dom.contains(selection.anchorNode) || !view.dom.contains(selection.focusNode)) return;
  for (const node of [selection.anchorNode, selection.focusNode]) {
    const element = node.nodeType === 1 ? node as Element : node.parentElement;
    if (element?.closest('[contenteditable="false"]')) return;
  }
  const anchor = view.posAtDOM(selection.anchorNode, selection.anchorOffset);
  const head = view.posAtDOM(selection.focusNode, selection.focusOffset);
  if (anchor < 0 || head < 0 || anchor > view.state.doc.content.size || head > view.state.doc.content.size) return;
  const $anchor = view.state.doc.resolve(anchor), $head = view.state.doc.resolve(head);
  if (!$anchor.parent.inlineContent || !$head.parent.inlineContent) return;
  const next = new TextSelection($anchor, $head);
  if (!next.eq(view.state.selection)) view.dispatch(view.state.tr.setSelection(next).setMeta('addToHistory', false));
}

export const NativeSelectionSync = Extension.create({
  name: 'nativeSelectionSync',
  priority: 1100,
  addProseMirrorPlugins() {
    let pendingNavigation = false;
    const reset = () => { pendingNavigation = false; return false; };
    return [new Plugin({
      props: { handleDOMEvents: {
        keydown(view, event) {
          if (event.isComposing || event.keyCode === 229 || view.composing) return reset();
          if (pendingNavigation) syncNativeTextSelection(view);
          pendingNavigation = navigationKeys.has(event.key);
          return false;
        },
        keyup(view, event) {
          if (event.isComposing || event.keyCode === 229 || view.composing) return reset();
          if (navigationKeys.has(event.key)) {
            if (pendingNavigation) syncNativeTextSelection(view);
            return reset();
          }
          return false;
        },
        compositionstart: reset, blur: reset, pointerdown: reset,
      } },
      view: () => ({ update(view, previous) { if (!previous.doc.eq(view.state.doc)) pendingNavigation = false; } }),
    })];
  },
});
