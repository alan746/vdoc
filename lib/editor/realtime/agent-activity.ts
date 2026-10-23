import type { Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node } from '@tiptap/pm/model';
import type { BlockRange } from '../document/block-index';

export type { BlockRange };
/** Resolves a block ID to its current document range, or undefined if it no longer exists. */
export type BlockLocator = (blockId: string) => BlockRange | undefined;

/** vdoc#33 agent activity: view-only decorations, never stored in the document,
 *  undo history or exports (same model as SearchHighlights). */
export type AgentActivity = {
  /** Briefly highlights the given blocks; clears itself unless a newer highlight replaced it. */
  highlight(blockIds: readonly string[]): void;
  /** Marks the block the agent is working on; null clears it. */
  setPresence(blockId: string | null): void;
  clear(): void;
  /** Removes the plugins from the editor. The handle is inert afterwards. */
  dispose(): void;
};

export function findBlockRange(doc: Node, blockId: string): BlockRange | undefined {
  let found: BlockRange | undefined;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (node.attrs.blockId === blockId) { found = { from: pos, to: pos + node.nodeSize }; return false; }
  });
  return found;
}

function decorationPlugin(key: PluginKey<DecorationSet>) {
  return new Plugin<DecorationSet>({
    key,
    state: { init: () => DecorationSet.empty, apply: (tr, previous) => tr.getMeta(key) ?? previous.map(tr.mapping, tr.doc) },
    props: { decorations: state => key.getState(state) },
  });
}

// Tiptap's unregisterPlugin removes every plugin whose key starts with the
// given key, so each attachment needs a distinct name, not just a new PluginKey.
let attachments = 0;

/** Registers the activity plugins on a live editor (realtime is optional, so
 *  they are not part of the base extension set) and returns a handle. */
export function attachAgentActivity(editor: Editor, options: { locate?: BlockLocator; highlightMs?: number } = {}): AgentActivity {
  const id = ++attachments;
  const highlightKey = new PluginKey<DecorationSet>(`vdocAgentHighlight${id}`);
  const presenceKey = new PluginKey<DecorationSet>(`vdocAgentPresence${id}`);
  const highlightPlugin = decorationPlugin(highlightKey), presencePlugin = decorationPlugin(presenceKey);
  const locate = options.locate ?? (blockId => findBlockRange(editor.state.doc, blockId));
  const highlightMs = options.highlightMs ?? 1500;
  let disposed = editor.isDestroyed, timer: ReturnType<typeof setTimeout> | undefined;
  if (!disposed) editor.registerPlugin(highlightPlugin, (plugin, plugins) => [...plugins, plugin, presencePlugin]);

  const decorate = (blockIds: readonly string[], className: string) => {
    const ranges = blockIds.map(locate).filter((range): range is BlockRange => range !== undefined);
    return ranges.length ? DecorationSet.create(editor.state.doc, ranges.map(range => Decoration.node(range.from, range.to, { class: className }))) : DecorationSet.empty;
  };
  // One transaction per update, and none at all when nothing would change.
  const update = (changes: [PluginKey<DecorationSet>, DecorationSet][]) => {
    if (disposed || editor.isDestroyed) return;
    const effective = changes.filter(([key, next]) => key.getState(editor.state) !== next);
    if (!effective.length) return;
    const tr = editor.state.tr.setMeta('addToHistory', false);
    for (const [key, next] of effective) tr.setMeta(key, next);
    editor.view.dispatch(tr);
  };
  const stopTimer = () => { clearTimeout(timer); timer = undefined; };

  return {
    highlight(blockIds) {
      if (disposed || editor.isDestroyed) return;
      const decorations = decorate(blockIds, 'vdoc-agent-highlight');
      if (decorations === DecorationSet.empty) return;
      stopTimer();
      update([[highlightKey, decorations]]);
      timer = setTimeout(() => { timer = undefined; update([[highlightKey, DecorationSet.empty]]); }, highlightMs);
    },
    setPresence(blockId) {
      if (disposed || editor.isDestroyed) return;
      update([[presenceKey, blockId ? decorate([blockId], 'vdoc-agent-presence') : DecorationSet.empty]]);
    },
    clear() {
      stopTimer();
      update([[highlightKey, DecorationSet.empty], [presenceKey, DecorationSet.empty]]);
    },
    dispose() {
      if (disposed) return;
      stopTimer();
      disposed = true;
      if (!editor.isDestroyed) editor.unregisterPlugin([highlightKey, presenceKey]);
    },
  };
}
