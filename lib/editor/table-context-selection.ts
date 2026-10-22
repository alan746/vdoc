import { TextSelection, type EditorState, type Selection } from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';

/** Preserve a selection only when the context click actually belongs to it. */
export function tableContextSelection(state: EditorState, position: number): Selection | null {
  if (position < 0 || position > state.doc.content.size) return null;
  const $pos = state.doc.resolve(position);
  let depth = $pos.depth;
  while (depth > 0 && !['tableCell','tableHeader'].includes($pos.node(depth).type.name)) depth--;
  if (!depth) return null;
  const cellPos = $pos.before(depth), cellEnd = cellPos + $pos.node(depth).nodeSize;
  const selection = state.selection;
  if (selection instanceof CellSelection) {
    let inside = false;
    selection.forEachCell((_node, pos) => { if (pos === cellPos) inside = true; });
    if (inside) return selection;
  } else if (selection.from > cellPos && selection.to < cellEnd) return selection;
  return TextSelection.near(state.doc.resolve(cellPos + 1));
}
