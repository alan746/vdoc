import type { Editor } from '@tiptap/core';
import { Plugin, PluginKey, Selection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node } from '@tiptap/pm/model';
import type { RealtimeActivity, StreamDraft } from '../../usecases/ports';
import { resolveTargetSelection } from '../commands/target-selection';
import { findTopLevelBlock } from '../document/block-placement';

let attachments = 0;
function positionOf(doc: Node, anchor: StreamDraft['anchor']): number | undefined {
  if (anchor.kind === 'document_end') return doc.content.size;
  if (anchor.kind === 'position') return Number.isInteger(anchor.pos) && anchor.pos >= 0 && anchor.pos <= doc.content.size ? anchor.pos : undefined;
  if (anchor.kind === 'text') {
    if (!Number.isInteger(anchor.offset) || anchor.offset < 0) return;
    const selection = resolveTargetSelection({ kind: 'text', blockId: anchor.blockId, start: anchor.offset, end: anchor.offset }, doc, Selection.atStart(doc));
    return 'error' in selection ? undefined : selection.from;
  }
  const block = findTopLevelBlock(doc, anchor.blockId);
  return block && block.pos + (anchor.kind === 'after_block' ? block.node.nodeSize : 0);
}

/** Render arriving text at its destination, without saving partial tool arguments.
 * A document change removes the draft in the same transaction as the real edit.
 * Further chunks for that call stay hidden, including after a concurrent user edit. */
export function attachStreamingDraft(editor: Editor) {
  const key = new PluginKey<DecorationSet>(`vdocStreamingDraft${++attachments}`);
  let current: string | undefined, invalidated = false, disposed = editor.isDestroyed;
  const plugin = new Plugin<DecorationSet>({
    key,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, previous) {
        if (tr.docChanged) { invalidated = true; return DecorationSet.empty; }
        return tr.getMeta(key) ?? previous;
      },
    },
    props: { decorations: state => key.getState(state) },
  });
  if (!disposed) editor.registerPlugin(plugin);
  const update = (decorations: DecorationSet) => {
    if (!disposed && !editor.isDestroyed && key.getState(editor.state) !== decorations)
      editor.view.dispatch(editor.state.tr.setMeta(key, decorations).setMeta('addToHistory', false));
  };
  const clear = () => { invalidated = true; update(DecorationSet.empty); };
  return {
    receive(event: RealtimeActivity) {
      if (disposed || editor.isDestroyed) return;
      if (event.type === 'interrupted') { clear(); return; }
      if (event.type === 'result' && event.callId === current) { clear(); return; }
      if (event.type !== 'preview') return;
      if (event.callId !== current) { current = event.callId; invalidated = false; }
      if (!['streaming', 'pending'].includes(event.phase)) { clear(); return; }
      if (invalidated) return;
      // Group pieces at the same destination to avoid one widget per paragraph.
      const groups = new Map<number, string[]>();
      for (const draft of (event.drafts ?? []).slice(0, 200)) {
        const pos = positionOf(editor.state.doc, draft.anchor);
        if (pos === undefined || !draft.text) continue;
        const texts = groups.get(pos) ?? []; texts.push(draft.text); groups.set(pos, texts);
      }
      const decorations = [...groups].map(([pos, texts]) => Decoration.widget(pos, () => {
        const widget = document.createElement('span');
        widget.className = 'vdoc-streaming-draft';
        widget.dataset.block = String(!editor.state.doc.resolve(pos).parent.isTextblock);
        widget.contentEditable = 'false';
        widget.setAttribute('aria-label', '正在生成的正文');
        widget.setAttribute('aria-busy', 'true');
        const label = document.createElement('span'); label.className = 'vdoc-streaming-label'; label.textContent = '正在生成…';
        const body = document.createElement('span'); body.className = 'vdoc-streaming-text'; body.textContent = texts.join('\n\n');
        widget.appendChild(label); widget.appendChild(body);
        return widget;
      }, { side: 1, ignoreSelection: true, stopEvent: () => true }));
      update(decorations.length ? DecorationSet.create(editor.state.doc, decorations) : DecorationSet.empty);
    },
    clear,
    dispose() { if (disposed) return; disposed = true; if (!editor.isDestroyed) editor.unregisterPlugin(key); },
  };
}
