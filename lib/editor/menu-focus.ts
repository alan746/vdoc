import type { Editor } from '@tiptap/core';

/** A closing focus scope can undo the focus performed by an editor command. */
export function restoreEditorFocusAfterMenu(editor: Editor, trigger: HTMLElement | null) {
  return requestAnimationFrame(() => {
    if (editor.isDestroyed || !editor.isEditable || editor.view.composing || !editor.view.dom.isConnected) return;
    const doc = editor.view.dom.ownerDocument, active = doc.activeElement;
    // A menu can open a dialog, search input, or another popover. Do not take
    // focus from that destination or from a field the user has since clicked.
    if (doc.querySelector('[role="dialog"][data-state="open"], [data-slot="popover-content"][data-state="open"], [role="menu"][data-state="open"]')) return;
    if (active !== doc.body && active !== trigger) return;
    editor.view.focus();
  });
}
