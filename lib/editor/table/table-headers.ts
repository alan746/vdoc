import type { Node } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { isHistoryTransaction } from '@tiptap/pm/history';
import { TableMap } from '@tiptap/pm/tables';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { everyStep, isTypingStep } from '../transaction-steps';

/** Old documents protected leading th rows during sorting. Keep that default
 * until the user explicitly pins/unpins; zero is distinct from legacy null. */
export function pinnedRowCount(table: Node): number {
  if (Number.isInteger(table.attrs.pinnedRows)) return Math.max(0, Math.min(table.childCount, table.attrs.pinnedRows));
  let count = 0;
  while (count < table.childCount && table.child(count).childCount &&
    Array.from({ length: table.child(count).childCount }, (_, i) => table.child(count).child(i)).every(cell => cell.type.name === 'tableHeader')) count++;
  return completePinnedBoundary(table, count);
}

/** A pinned region must include every row of any rowspan it touches. */
export function completePinnedBoundary(table: Node, count: number): number {
  const map = TableMap.get(table);
  count = Math.max(0, Math.min(map.height, count));
  for (let row = 0; row < count; row++) {
    for (const offset of new Set(map.map.slice(row * map.width, (row + 1) * map.width)))
      count = Math.max(count, map.findCell(offset).bottom);
  }
  return count;
}

export function pinnedHeaderOffset(tableTop: number, tableHeight: number, headerHeight: number, viewportTop: number, scale: number) {
  return scale > 0 ? Math.max(0, Math.min(viewportTop - tableTop, tableHeight - headerHeight)) / scale : 0;
}

/** Header cells move for WebKit paint order; the tr retains its layout box.
 * Keep the row's own height when a cell spans several rows. */
export function tableRowVisualRect(row: HTMLTableRowElement) {
  const rect = row.getBoundingClientRect();
  const top = row.classList.contains('vdoc-pinned-row') && row.cells[0]
    ? row.cells[0].getBoundingClientRect().top : rect.top;
  return { top, bottom: top + rect.height, left: rect.left, right: rect.right, width: rect.width, height: rect.height };
}

/** The ruler occupies the top of the canvas, including when CSS zoom changes. */
export function pinnedHeaderViewport(canvas: Element | null, win: Window) {
  const bounds = canvas?.getBoundingClientRect();
  const top = Math.max(bounds?.top ?? 0, canvas?.querySelector('.paragraph-ruler')?.getBoundingClientRect().bottom ?? 0);
  return { top, height: Math.max(0, (bounds?.bottom ?? win.innerHeight) - top) };
}

/** Calls `visit` for every table, without descending into textblocks or atoms. */
function forEachTable(doc: Node, visit: (table: Node, pos: number) => void) {
  doc.descendants((node, pos) => {
    if (node.type.name === 'table') visit(node, pos);
    return !node.isTextblock && !node.isAtom;
  });
}

function pinnedRowDecorations(doc: Node): DecorationSet {
  const decorations: Decoration[] = [];
  forEachTable(doc, (table, pos) => {
    const count = pinnedRowCount(table);
    table.forEach((row, offset, index) => {
      if (index < count) decorations.push(Decoration.node(pos + 1 + offset, pos + 1 + offset + row.nodeSize, { class: 'vdoc-pinned-row' }));
    });
  });
  return DecorationSet.create(doc, decorations);
}

export const tableHeadersKey = new PluginKey<DecorationSet>('vdocTableHeaders');

export function tableHeadersPlugin() {
  return new Plugin<DecorationSet>({
    key: tableHeadersKey,
    // Typing inside a cell cannot change a table's rows, row IDs, spans or pin
    // count, so the decorations only need mapping; anything else rebuilds them.
    state: {
      init: (_, state: EditorState) => pinnedRowDecorations(state.doc),
      apply: (tr, previous) => !tr.docChanged ? previous
        : everyStep([tr], isTypingStep) ? previous.map(tr.mapping, tr.doc)
        : pinnedRowDecorations(tr.doc),
    },
    appendTransaction(transactions, oldState, state) {
      if (!transactions.some(tr => tr.docChanged) || transactions.some(isHistoryTransaction)) return null;
      // Explicit pin commands use setNodeMarkup, which is not a typing step.
      if (everyStep(transactions, isTypingStep)) return null;
      const previous = new Map<string, Node>();
      const explicit = new Set(transactions.flatMap(tr => tr.getMeta('vdocPinnedRows') || []));
      forEachTable(oldState.doc, table => { if (table.attrs.blockId) previous.set(table.attrs.blockId, table); });
      const tr = state.tr;
      forEachTable(state.doc, (table, pos) => {
        let count = pinnedRowCount(table);
        const old = previous.get(table.attrs.blockId);
        // Explicit pin commands and history already carry their chosen count.
        // Otherwise keep the pinned rows through insertions/deletions within it.
        if (old && !explicit.has(table.attrs.blockId) && old.attrs.pinnedRows === table.attrs.pinnedRows) {
          const pinnedIds = new Set(Array.from({ length: pinnedRowCount(old) }, (_, i) => old.child(i).attrs.blockId).filter(Boolean));
          if (pinnedIds.size) {
            count = 0;
            table.forEach((row, _, index) => { if (pinnedIds.has(row.attrs.blockId)) count = index + 1; });
          }
        }
        count = completePinnedBoundary(table, count);
        if (count !== pinnedRowCount(table) || table.attrs.pinnedRows != null && count !== table.attrs.pinnedRows)
          tr.setNodeMarkup(pos, undefined, { ...table.attrs, pinnedRows: count });
      });
      // Appended to the original history event, so one Undo restores both rows
      // and their pin count. Scroll-only updates never dispatch a transaction.
      return tr.docChanged ? tr : null;
    },
    props: {
      decorations: state => tableHeadersKey.getState(state),
    },
    view(view) {
      const win = view.dom.ownerDocument.defaultView!;
      let frame = 0, destroyed = false;
      const observed = new Set<Element>();
      const update = () => {
        frame = 0;
        if (destroyed) return;
        const canvas = view.dom.closest('.canvas-scroll');
        const viewport = pinnedHeaderViewport(canvas, win);
        const next = new Set<Element>([view.dom]);
        for (const table of view.dom.querySelectorAll<HTMLTableElement>('table')) {
          next.add(table);
          const rows = Array.from(table.rows).filter(row => row.classList.contains('vdoc-pinned-row'));
          for (const row of rows) next.add(row);
          const rect = table.getBoundingClientRect(), scale = table.offsetWidth ? rect.width / table.offsetWidth : 1;
          const height = rows.reduce((sum, row) => sum + row.getBoundingClientRect().height, 0);
          // Do not cover the entire writing viewport with an oversized header.
          const fits = height < viewport.height;
          const offset = rows.length && fits ? pinnedHeaderOffset(rect.top, rect.height, height, viewport.top, scale) : 0;
          const value = `${offset}px`;
          if (table.style.getPropertyValue('--vdoc-pin-offset') !== value) table.style.setProperty('--vdoc-pin-offset', value);
          table.classList.toggle('vdoc-header-stuck', offset > 0);
        }
        for (const element of observed) if (!next.has(element)) { observer?.unobserve(element); observed.delete(element); }
        for (const element of next) if (!observed.has(element)) { observer?.observe(element); observed.add(element); }
      };
      const schedule = () => { if (!destroyed && !frame) frame = win.requestAnimationFrame(update); };
      const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
      // CSS zoom does not always trigger ResizeObserver on table content boxes.
      const paper = view.dom.closest('.paper-wrap');
      const zoomObserver = typeof MutationObserver === 'undefined' ? null : new MutationObserver(schedule);
      if (paper) zoomObserver?.observe(paper, { attributes: true, attributeFilter: ['style'] });
      win.addEventListener('scroll', schedule, true); win.addEventListener('resize', schedule);
      schedule();
      return { update: schedule, destroy() {
        destroyed = true; win.cancelAnimationFrame(frame); observer?.disconnect(); zoomObserver?.disconnect();
        win.removeEventListener('scroll', schedule, true); win.removeEventListener('resize', schedule);
      } };
    },
  });
}
