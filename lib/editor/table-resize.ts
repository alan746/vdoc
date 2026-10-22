import type { Node } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { TableMap } from '@tiptap/pm/tables';
import { updateColumns } from '@tiptap/extension-table';
import type { OperationRequest } from './operations';

export type CommitTableResize = (request: OperationRequest) => void;
type Preview = { rowPos: number; height: number; cells: number[] } | null;
const resizeKey = new PluginKey<Preview>('vdocTableResize');
type Edge = {
  axis: 'row' | 'column'; index: number; table: HTMLTableElement; node: Node;
  tablePos: number; rowPos: number; cells: number[]; size: number; scale: number;
};

export function resizedDimension(axis: Edge['axis'], initial: number, delta: number, scale: number) {
  return Math.round(Math.max(axis === 'row' ? 1 : 40, Math.min(axis === 'row' ? 1000 : 1200, initial + delta / scale)));
}

function scaleOf(table: HTMLTableElement) {
  return table.getBoundingClientRect().width / table.offsetWidth;
}

/** Hit only visible cell edges. A merged cell's bottom/trailing edge maps to the
 * final logical row/column of its span, never its first row/column. */
function edgeAt(view: EditorView, event: MouseEvent): Edge | null {
  if (!view.editable || view.composing || !(event.target instanceof Element)) return null;
  const cell = event.target.closest('td,th') as HTMLTableCellElement | null;
  const table = cell?.closest('table');
  if (!cell || !table || !view.dom.contains(table)) return null;
  const $pos = view.state.doc.resolve(view.posAtDOM(cell, 0));
  let depth = $pos.depth;
  while (depth > 0 && $pos.node(depth).type.name !== 'table') depth--;
  if (!depth) return null;
  const node = $pos.node(depth), tablePos = $pos.before(depth), map = TableMap.get(node);
  let cellDepth = $pos.depth;
  while (cellDepth > depth && !['tableCell', 'tableHeader'].includes($pos.node(cellDepth).type.name)) cellDepth--;
  if (cellDepth === depth) return null;
  const bounds = map.findCell($pos.before(cellDepth) - tablePos - 1);
  const rect = cell.getBoundingClientRect(), scale = scaleOf(table);
  if (!Number.isFinite(scale) || scale <= 0) return null;
  let axis: Edge['axis'], index: number;
  const rtl = node.attrs.columnDirection === 'rtl';
  const trailing = rtl ? rect.left : rect.right, leading = rtl ? rect.right : rect.left;
  if (Math.abs(event.clientX - trailing) <= 5) { axis = 'column'; index = bounds.right - 1; }
  else if (bounds.left > 0 && Math.abs(event.clientX - leading) <= 5) { axis = 'column'; index = bounds.left - 1; }
  else if (Math.abs(event.clientY - rect.bottom) <= 5) { axis = 'row'; index = bounds.bottom - 1; }
  else if (bounds.top > 0 && Math.abs(event.clientY - rect.top) <= 5) { axis = 'row'; index = bounds.top - 1; }
  else return null;
  let rowPos = tablePos + 1;
  for (let i = 0; i < (axis === 'row' ? index : 0); i++) rowPos += node.child(i).nodeSize;
  const element = axis === 'row' ? table.rows[index] : table.querySelectorAll(':scope > colgroup > col')[index];
  if (!element) return null;
  const size = (axis === 'row' ? element.getBoundingClientRect().height : element.getBoundingClientRect().width) / scale;
  const cells = axis === 'row' ? [...new Set(map.map.slice(index * map.width, (index + 1) * map.width))]
    .filter(offset => node.nodeAt(offset)!.attrs.rowspan === 1).map(offset => tablePos + 1 + offset) : [];
  return { axis, index, table, node, tablePos, rowPos, cells, size, scale };
}

/** Preview does not modify the document. Mouseup commits exactly one operation;
 * Escape, blur, scroll, composition or a concurrent document edit cancels it. */
export function tableResizePlugin(commit: CommitTableResize) {
  let cancel: (() => void) | null = null;
  let startDoc: Node | null = null;
  return new Plugin<Preview>({
    key: resizeKey,
    state: {
      init: () => null,
      apply: (tr, previous) => tr.docChanged ? null : tr.getMeta(resizeKey) !== undefined ? tr.getMeta(resizeKey) : previous,
    },
    props: {
      decorations(state) {
        const preview = resizeKey.getState(state);
        if (!preview) return null;
        const row = state.doc.nodeAt(preview.rowPos);
        if (!row) return null;
        return DecorationSet.create(state.doc, [
          // Avoid decorating the schema's own height property: removing such a
          // decoration would also remove the original inline height on cancel.
          Decoration.node(preview.rowPos, preview.rowPos + row.nodeSize, { class: 'table-row-resizing', style: `--vdoc-preview-height:${preview.height}px` }),
          ...preview.cells.map(pos => Decoration.node(pos, pos + state.doc.nodeAt(pos)!.nodeSize, { class: 'table-cell-resizing' })),
        ]);
      },
      handleDOMEvents: {
        mousemove(view, event) {
          if (cancel) return true;
          const edge = edgeAt(view, event);
          view.dom.classList.toggle('resize-cursor', edge?.axis === 'column');
          view.dom.classList.toggle('row-resize-cursor', edge?.axis === 'row');
          return false;
        },
        mouseleave(view) {
          if (!cancel) view.dom.classList.remove('resize-cursor', 'row-resize-cursor');
          return false;
        },
        mousedown(view, event) {
          if (event.button !== 0) return false;
          const edge = edgeAt(view, event);
          if (!edge || !edge.node.attrs.blockId) return false;
          event.preventDefault(); cancel?.();
          const win = view.dom.ownerDocument.defaultView!;
          const start = edge.axis === 'row' ? event.clientY : event.clientX;
          let size = Math.round(edge.size), moved = false;
          startDoc = view.state.doc;
          const badge = view.dom.ownerDocument.createElement('div');
          badge.className = 'table-resize-badge'; badge.setAttribute('role', 'status');
          view.dom.ownerDocument.body.appendChild(badge);
          const oldCursor = view.dom.ownerDocument.body.style.cursor;
          view.dom.ownerDocument.body.style.cursor = edge.axis === 'row' ? 'row-resize' : 'col-resize';
          const cleanup = () => {
            cancel = null; startDoc = null;
            win.removeEventListener('mousemove', move); win.removeEventListener('mouseup', finish);
            win.removeEventListener('keydown', key, true); win.removeEventListener('blur', cleanup);
            win.removeEventListener('scroll', cleanup, true); win.removeEventListener('resize', cleanup);
            view.dom.removeEventListener('compositionstart', cleanup);
            badge.remove(); view.dom.ownerDocument.body.style.cursor = oldCursor;
            view.dom.classList.remove('resize-cursor', 'row-resize-cursor');
            if (view.isDestroyed) return;
            if (resizeKey.getState(view.state)) view.dispatch(view.state.tr.setMeta(resizeKey, null));
            if (edge.axis === 'column' && edge.table.isConnected) {
              const current = view.state.doc.nodeAt(edge.tablePos);
              const group = edge.table.querySelector(':scope > colgroup') as HTMLTableColElement | null;
              if (group && current?.type.name === 'table') updateColumns(current, group, edge.table, 40);
            }
          };
          const move = (e: MouseEvent) => {
            if (!(e.buttons & 1) || view.composing || view.state.doc !== startDoc || Math.abs(scaleOf(edge.table) - edge.scale) > 0.01) { cleanup(); return; }
            const delta = ((edge.axis === 'row' ? e.clientY : e.clientX) - start) * (edge.axis === 'column' && edge.node.attrs.columnDirection === 'rtl' ? -1 : 1);
            moved ||= Math.abs(delta) >= 2;
            if (!moved) return;
            size = resizedDimension(edge.axis, edge.size, delta, edge.scale);
            if (edge.axis === 'row') view.dispatch(view.state.tr.setMeta(resizeKey, { rowPos: edge.rowPos, height: size, cells: edge.cells }));
            else updateColumns(edge.node, edge.table.querySelector(':scope > colgroup') as HTMLTableColElement, edge.table, 40, edge.index, size);
            badge.textContent = `${edge.axis === 'row' ? 'Minimum height' : 'Width'}: ${size} px`;
            badge.style.left = `${Math.max(8, Math.min(e.clientX + 14, win.innerWidth - 190))}px`;
            badge.style.top = `${Math.max(8, Math.min(e.clientY + 14, win.innerHeight - 40))}px`;
          };
          const finish = (e: MouseEvent) => {
            const valid = view.state.doc === startDoc && !view.composing && view.editable;
            // Use the release position even when the browser coalesces mousemoves.
            const delta = ((edge.axis === 'row' ? e.clientY : e.clientX) - start) * (edge.axis === 'column' && edge.node.attrs.columnDirection === 'rtl' ? -1 : 1);
            size = resizedDimension(edge.axis, edge.size, delta, edge.scale);
            const changed = Math.abs(delta) >= 2 && size !== Math.round(edge.size);
            cleanup();
            if (valid && changed) commit({ source: 'toolbar', target: { kind: 'cells', tableId: edge.node.attrs.blockId, row: edge.axis === 'row' ? edge.index : 0, col: edge.axis === 'column' ? edge.index : 0 },
              operations: [edge.axis === 'row' ? { type: 'table.rowHeight', row: edge.index, height: size } : { type: 'table.columnWidth', column: edge.index, width: size }] });
          };
          const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cleanup(); } };
          cancel = cleanup;
          win.addEventListener('mousemove', move); win.addEventListener('mouseup', finish);
          win.addEventListener('keydown', key, true); win.addEventListener('blur', cleanup);
          win.addEventListener('scroll', cleanup, true); win.addEventListener('resize', cleanup);
          view.dom.addEventListener('compositionstart', cleanup);
          return true;
        },
      },
    },
    view: () => ({ update(view) { if (startDoc && (view.state.doc !== startDoc || !view.editable)) cancel?.(); }, destroy() { cancel?.(); } }),
  });
}
