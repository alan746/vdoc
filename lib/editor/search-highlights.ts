import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Match } from './search';

const key = new PluginKey<DecorationSet>('vdocSearchHighlights');
export const SearchHighlights = Extension.create({
  name: 'searchHighlights',
  addProseMirrorPlugins() {
    return [new Plugin<DecorationSet>({
      key,
      state: {
        init: () => DecorationSet.empty,
        apply: (tr, previous) => tr.getMeta(key) ?? previous.map(tr.mapping, tr.doc),
      },
      props: { decorations: state => key.getState(state) },
    })];
  },
});

/** View-only marks: never stored in the document, undo history or exports. */
export function highlightSearchMatches(editor: Editor, matches: Match[], active: number) {
  if (editor.isDestroyed) return;
  const decorations = DecorationSet.create(editor.state.doc, matches.map((match, index) => Decoration.inline(match.from, match.to, {
    class: index === active ? 'vdoc-search-match vdoc-search-current' : 'vdoc-search-match',
    ...(index === active ? { 'data-search-from': String(match.from) } : {}),
  })));
  editor.view.dispatch(editor.state.tr.setMeta(key, decorations).setMeta('addToHistory', false));
}
