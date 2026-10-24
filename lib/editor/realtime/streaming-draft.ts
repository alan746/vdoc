import type { Editor } from '@tiptap/core';
import { Plugin, PluginKey, Selection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { DOMSerializer, type Node, type Schema } from '@tiptap/pm/model';
import type { RealtimeActivity, StreamDraft } from '../../usecases/ports';
import { resolveTargetSelection } from '../commands/target-selection';
import { findListItem, findTopLevelBlock } from '../document/block-placement';

let attachments = 0;
function positionOf(doc: Node, anchor: StreamDraft['anchor']): number | undefined {
  if (anchor.kind === 'document_end') return doc.content.size;
  if (anchor.kind === 'position') return Number.isInteger(anchor.pos) && anchor.pos >= 0 && anchor.pos <= doc.content.size ? anchor.pos : undefined;
  if (anchor.kind === 'text') {
    if (!Number.isInteger(anchor.offset) || anchor.offset < 0) return;
    const selection = resolveTargetSelection({ kind: 'text', blockId: anchor.blockId, start: anchor.offset, end: anchor.offset }, doc, Selection.atStart(doc));
    return 'error' in selection ? undefined : selection.from;
  }
  // A block anchored on a list item joins that list, as block.insert does.
  const block = findTopLevelBlock(doc, anchor.blockId) ?? findListItem(doc, anchor.blockId);
  return block && block.pos + (anchor.kind === 'after_block' ? block.node.nodeSize : 0);
}

/** The node the finished edit will insert, built only for display. */
function nodeOf(schema: Schema, draft: StreamDraft, parent: Node): Node | undefined {
  const { block } = draft, text = (value: string) => value ? schema.text(value) : null;
  if (!block) return;
  if (block.kind === 'table') {
    const cell = (type: string, value: string) => schema.nodes[type].create(null, schema.nodes.paragraph.create(null, text(value)));
    const rows = block.rows.map((row, index) => schema.nodes.tableRow.create(null, row.map(value => cell(block.header && index === 0 ? 'tableHeader' : 'tableCell', value))));
    return rows.length ? schema.nodes.table.create(null, rows) : undefined;
  }
  const node = block.kind === 'heading' ? schema.nodes.heading.create({ level: block.level }, text(draft.text)) : schema.nodes.paragraph.create(null, text(draft.text));
  const item = parent.type.contentMatch.defaultType;
  return parent.type.spec.group?.includes('list') && item ? item.create(null, node) : node;
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
      const groups = new Map<number, StreamDraft[]>();
      for (const draft of (event.drafts ?? []).slice(0, 200)) {
        const pos = positionOf(editor.state.doc, draft.anchor);
        if (pos === undefined || !draft.text) continue;
        const drafts = groups.get(pos) ?? []; drafts.push(draft); groups.set(pos, drafts);
      }
      // Blocks render through the editor's own schema, so headings, list items and
      // tables stream with the markup and styles the committed edit will have.
      const serializer = DOMSerializer.fromSchema(editor.schema);
      const decorations = [...groups].map(([pos, drafts]) => Decoration.widget(pos, () => {
        const parent = editor.state.doc.resolve(pos).parent, inline = parent.isTextblock;
        const widget = document.createElement(inline ? 'span' : 'div');
        widget.className = 'vdoc-streaming-draft';
        widget.dataset.block = String(!inline);
        widget.contentEditable = 'false';
        widget.setAttribute('aria-label', 'Text being written');
        widget.setAttribute('aria-busy', 'true');
        for (const draft of drafts) {
          let node: Node | undefined;
          try { node = inline ? undefined : nodeOf(editor.schema, draft, parent); } catch { node = undefined; }
          if (node) widget.appendChild(serializer.serializeNode(node));
          else widget.appendChild(document.createTextNode(draft.text));
        }
        return widget;
      }, { side: 1, ignoreSelection: true, stopEvent: () => true }));
      // Hidden the way the commit replaces it, so the draft does not shift when it lands.
      const doc = editor.state.doc, blank = doc.firstChild;
      if (event.replacesBlankDocument && decorations.length && doc.childCount === 1 && blank?.type.name === 'paragraph' && blank.content.size === 0)
        decorations.push(Decoration.node(0, blank.nodeSize, { class: 'vdoc-streaming-replaced' }));
      update(decorations.length ? DecorationSet.create(editor.state.doc, decorations) : DecorationSet.empty);
    },
    clear,
    dispose() { if (disposed) return; disposed = true; if (!editor.isDestroyed) editor.unregisterPlugin(key); },
  };
}
