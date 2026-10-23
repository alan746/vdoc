import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node } from '@tiptap/pm/model';

const highlightKey = new PluginKey<DecorationSet>('vdocAgentHighlights');
const presenceKey = new PluginKey<DecorationSet>('vdocAgentPresence');

function decorationPlugin(key: PluginKey<DecorationSet>) {
  return new Plugin<DecorationSet>({
    key,
    state: { init: () => DecorationSet.empty, apply: (tr, previous) => tr.getMeta(key) ?? previous.map(tr.mapping, tr.doc) },
    props: { decorations: state => key.getState(state) },
  });
}

/** vdoc#33: agent activity visualisation. View-only decorations, like
 *  SearchHighlights — never stored in the document, undo history or
 *  exports. Loaded only while a realtime connection is enabled. */
export const AgentActivity = Extension.create({
  name: 'agentActivity',
  addProseMirrorPlugins() { return [decorationPlugin(highlightKey), decorationPlugin(presenceKey)]; },
});

function blockRange(doc: Node, blockId: string) {
  let found: { from: number; to: number } | undefined;
  doc.descendants((node, pos) => { if (node.attrs.blockId === blockId) found = { from: pos, to: pos + node.nodeSize }; });
  return found;
}
function setDecorations(editor: Editor, key: PluginKey<DecorationSet>, decorations: DecorationSet) {
  if (editor.isDestroyed) return;
  editor.view.dispatch(editor.state.tr.setMeta(key, decorations).setMeta('addToHistory', false));
}

// Per-editor, so an older call's clear-timeout cannot cancel a newer call's
// highlight on a different editor instance sharing this module.
const sequences = new WeakMap<Editor, number>();
function nextSequence(editor: Editor) {
  const next = (sequences.get(editor) ?? 0) + 1;
  sequences.set(editor, next);
  return next;
}

/** Brief highlight on the blocks a just-applied agent call changed. Clears
 *  itself after `durationMs`, unless a newer call has already replaced it. */
export function highlightChangedBlocks(editor: Editor, blockIds: readonly string[], durationMs = 1500) {
  if (editor.isDestroyed || !blockIds.length) return;
  const ranges = blockIds.map(id => blockRange(editor.state.doc, id)).filter((range): range is { from: number; to: number } => !!range);
  if (!ranges.length) return;
  const mine = nextSequence(editor);
  setDecorations(editor, highlightKey, DecorationSet.create(editor.state.doc, ranges.map(range => Decoration.node(range.from, range.to, { class: 'vdoc-agent-highlight' }))));
  setTimeout(() => {
    if (editor.isDestroyed || sequences.get(editor) !== mine) return;
    setDecorations(editor, highlightKey, DecorationSet.empty);
  }, durationMs);
}

/** Persistent marker for the block the agent is currently working on; moves
 *  with each committed edit. Pass null to clear it (e.g. on disconnect). */
export function setAgentPresence(editor: Editor, blockId: string | null) {
  if (editor.isDestroyed) return;
  const range = blockId ? blockRange(editor.state.doc, blockId) : undefined;
  setDecorations(editor, presenceKey, range ? DecorationSet.create(editor.state.doc, [Decoration.node(range.from, range.to, { class: 'vdoc-agent-presence' })]) : DecorationSet.empty);
}

/** Clears both the highlight and the presence marker, e.g. on disconnect. */
export function clearAgentActivity(editor: Editor) {
  setAgentPresence(editor, null);
  setDecorations(editor, highlightKey, DecorationSet.empty);
}
