import { Plugin, Selection } from '@tiptap/pm/state';
import { CellSelection, cellAround, nextCell } from '@tiptap/pm/tables';

/** Operations keep logical indices; UI arrows describe physical screen directions. */
export function columnDelta(direction: unknown, physical: 'left' | 'right') {
  return (physical === 'left' ? -1 : 1) * (direction === 'rtl' ? -1 : 1);
}

export function rtlTableNavigation() {
  return new Plugin({ props: { handleKeyDown(view, event) {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key) || event.altKey || event.metaKey || event.ctrlKey || view.composing) return false;
    const selection = view.state.selection;
    const cell = selection instanceof CellSelection ? selection.$headCell : cellAround(selection.$head);
    if (!cell || cell.node(-1).attrs.columnDirection !== 'rtl') return false;
    if (!(selection instanceof CellSelection) && (!selection.empty || !view.endOfTextblock(event.key === 'ArrowLeft' ? 'left' : 'right'))) return false;
    // Let native bidi text movement finish inside the cell before crossing columns.
    if (!(selection instanceof CellSelection)) {
      const head = selection.$head;
      const textDirection = head.parentOffset === 0 ? -1 : head.parentOffset === head.parent.content.size ? 1 : 0;
      if (!textDirection) return false;
      for (let depth = head.depth - 1; depth > cell.depth; depth--) {
        const parent = head.node(depth);
        if ((textDirection < 0 ? head.index(depth) : head.indexAfter(depth)) !== (textDirection < 0 ? 0 : parent.childCount)) {
          const boundary = textDirection > 0 ? head.after() : head.before();
          view.dispatch(view.state.tr.setSelection(Selection.near(view.state.doc.resolve(boundary), textDirection)).scrollIntoView());
          return true;
        }
      }
    }
    const delta = columnDelta('rtl', event.key === 'ArrowLeft' ? 'left' : 'right');
    const next = nextCell(cell, 'horiz', delta);
    if (!next) return true; // Do not fall through to the upstream LTR cell movement.
    const target = event.shiftKey ? new CellSelection(selection instanceof CellSelection ? selection.$anchorCell : cell, next)
      : selection instanceof CellSelection ? new CellSelection(next)
      : Selection.near(view.state.doc.resolve(next.pos + (delta > 0 ? 1 : next.nodeAfter!.nodeSize - 1)), delta > 0 ? 1 : -1);
    view.dispatch(view.state.tr.setSelection(target).scrollIntoView()); return true;
  } } });
}
