'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { TableMap } from '@tiptap/pm/tables';
import { GripVertical, GripHorizontal, Pin, ArrowDownAZ, ArrowUpAZ } from 'lucide-react';
import { toast } from 'sonner';
import type { DocumentEngine } from '@/lib/editor/engine';
import type { Operation } from '@/lib/editor/operations';
import { completePinnedBoundary, tableRowVisualRect } from '@/lib/editor/table-headers';
import { createTableAutoScroll } from '@/lib/editor/table-auto-scroll';
import { columnDelta } from '@/lib/editor/table-direction';
import { reorderedTable } from '@/lib/editor/table-move';

type Hover = { table: PMNode; element: HTMLTableElement; row: number; col: number; doc: PMNode; revision: number; x: number; y: number; cx: number; cy: number; showColumn: boolean };
type Drop = { axis: 'row' | 'column'; x: number; y: number; length: number; valid: boolean; label: string };

export function TableHandles({ editor, engine }: { editor: Editor; engine: DocumentEngine }) {
  const [hover, setHover] = useState<Hover | null>(null), [drop, setDrop] = useState<Drop | null>(null);
  const scrollDuringDrag = useRef<((event: Event) => boolean) | null>(null);
  const cancelDrag = useRef<(() => void) | null>(null);
  useEffect(() => {
    const move = (event: MouseEvent) => {
      if (cancelDrag.current || event.buttons || !(event.target instanceof Element)) return;
      if (event.target.closest('.table-hover-tools')) return;
      const cell = event.target.closest('td,th'), element = cell?.closest('table');
      if (!cell || !element || !editor.view.dom.contains(cell) || !editor.isEditable) {
        // Keep the controls reachable across the small gap outside the table.
        setHover(previous => previous && editor.isEditable && (
          event.clientX >= previous.x - 4 && event.clientX <= previous.x + 65 && event.clientY >= previous.y - 4 && event.clientY <= previous.y + 32 ||
          previous.showColumn && event.clientX >= previous.cx - 4 && event.clientX <= previous.cx + 88 && event.clientY >= previous.cy - 4 && event.clientY <= previous.cy + 34
        ) ? previous : null); return;
      }
      const pos = editor.view.posAtDOM(cell, 0), resolved = editor.state.doc.resolve(pos);
      let depth = resolved.depth;
      while (depth > 0 && resolved.node(depth).type.name !== 'table') depth--;
      if (!depth) { setHover(null); return; }
      const table = resolved.node(depth), map = TableMap.get(table);
      const offset = resolved.before(depth + 2) - resolved.start(depth);
      const bounds = map.findCell(offset), rect = cell.getBoundingClientRect();
      const tableRect = element.getBoundingClientRect();
      const clip = element.closest('.tableWrapper')!.getBoundingClientRect();
      const canvas = editor.view.dom.closest('.canvas-scroll')!.getBoundingClientRect();
      const cols = element.querySelectorAll(':scope > colgroup > col');
      // Logical grid coordinates also work when the first row contains colspans.
      let col = bounds.left;
      for (let i = bounds.left; i < bounds.right; i++) {
        const r = cols[i]?.getBoundingClientRect();
        if (r && event.clientX >= r.left && event.clientX <= r.right) { col = i; break; }
      }
      const colRect = cols[col]?.getBoundingClientRect() || rect;
      setHover({ table, element, row: bounds.top, col, doc: editor.state.doc, revision: engine.revision,
        x: table.attrs.columnDirection === 'rtl' ? Math.min(canvas.right - 60, Math.min(tableRect.right, clip.right) + 4) : Math.max(8, Math.max(tableRect.left, clip.left) - 60),
        y: Math.max(canvas.top + 4, Math.min(rect.top + 6, canvas.bottom - 30)),
        cx: Math.max(8, Math.min(colRect.left + colRect.width / 2 - 42, Math.min(clip.right, window.innerWidth) - 88)),
        cy: tableRect.top - 29,
        showColumn: tableRect.top >= canvas.top + 29 && tableRect.top < canvas.bottom,
      });
    };
    const hide = () => { cancelDrag.current?.(); setHover(null); };
    const change = ({ transaction }: { transaction: { docChanged: boolean } }) => { if (transaction.docChanged) hide(); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') hide(); };
    document.addEventListener('mousemove', move);
    const scroll = (event: Event) => { if (!scrollDuringDrag.current?.(event)) hide(); };
    document.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', hide); window.addEventListener('blur', hide);
    document.addEventListener('keydown', key); document.addEventListener('compositionstart', hide);
    editor.on('transaction', change);
    return () => {
      cancelDrag.current?.(); document.removeEventListener('mousemove', move);
      document.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', hide); window.removeEventListener('blur', hide);
      document.removeEventListener('keydown', key); document.removeEventListener('compositionstart', hide);
      editor.off('transaction', change);
    };
  }, [editor, engine]);

  const execute = (source: Hover, operation: Operation) => {
    if (editor.state.doc !== source.doc) { setHover(null); return; }
    const result = engine.execute({ source: 'toolbar', expectedRevision: source.revision,
      target: { kind: 'cells', tableId: source.table.attrs.blockId, row: source.row, col: source.col }, operations: [operation] });
    if (!result.ok) toast.error(result.error || 'This table operation is unavailable.');
    setHover(null); editor.view.focus();
  };
  const startDrag = (event: React.MouseEvent, axis: 'row' | 'column') => {
    if (!hover || event.button !== 0 || editor.view.composing) return;
    event.preventDefault();
    const source = hover, from = axis === 'row' ? source.row : source.col;
    const startX = event.clientX, startY = event.clientY;
    let to = from, moved = false, valid = false, x = startX, y = startY;
    const canvasElement = editor.view.dom.closest<HTMLElement>('.canvas-scroll')!;
    const wrapperElement = source.element.closest<HTMLElement>('.tableWrapper')!;
    const updateDrop = () => {
      const canvas = editor.view.dom.closest('.canvas-scroll')!.getBoundingClientRect();
      const wrapper = source.element.closest('.tableWrapper')!.getBoundingClientRect();
      const tableRect = source.element.getBoundingClientRect();
      const rects = axis === 'row' ? Array.from(source.element.rows, tableRowVisualRect)
        : Array.from(source.element.querySelectorAll(':scope > colgroup > col'), c => c.getBoundingClientRect());
      const coordinate = axis === 'row' ? y : x;
      const rtl = axis === 'column' && source.table.attrs.columnDirection === 'rtl';
      let boundary = rects.findIndex(r => rtl ? coordinate > r.left + r.width / 2 : coordinate < (axis === 'row' ? r.top + r.height / 2 : r.left + r.width / 2));
      if (boundary < 0) boundary = rects.length;
      to = boundary > from ? boundary - 1 : boundary;
      const inside = y >= canvas.top && y <= canvas.bottom &&
        x >= Math.max(0, wrapper.left - 65) && x <= Math.min(window.innerWidth, wrapper.right + 65) &&
        (axis === 'row' ? y >= tableRect.top - 8 && y <= tableRect.bottom + 8 : y >= tableRect.top - 40 && y <= tableRect.bottom);
      valid = inside && !!reorderedTable(source.table, axis, from, to);
      const edge = boundary === rects.length ? (axis === 'row' ? rects.at(-1)!.bottom : rtl ? rects.at(-1)!.left : rects.at(-1)!.right)
        : axis === 'row' ? rects[boundary].top : rtl ? rects[boundary].right : rects[boundary].left;
      setDrop({ axis, valid,
        x: axis === 'row' ? Math.max(tableRect.left, wrapper.left) : edge,
        y: axis === 'row' ? edge : Math.max(tableRect.top, canvas.top),
        length: axis === 'row' ? Math.min(tableRect.right, wrapper.right) - Math.max(tableRect.left, wrapper.left) : Math.min(tableRect.bottom, canvas.bottom) - Math.max(tableRect.top, canvas.top),
        label: valid ? `Move ${axis} ${from + 1} to position ${to + 1}` : from === to ? `Keep ${axis} in place` : 'Cannot drop here: merged cells, pinned rows, or outside the table',
      });
    };
    const autoScroll = createTableAutoScroll(axis, canvasElement, wrapperElement, source.element, updateDrop);
    const move = (e: MouseEvent) => {
      x = e.clientX; y = e.clientY;
      if (!moved && Math.hypot(x - startX, y - startY) < 4) return;
      moved = true; updateDrop(); autoScroll.update(x, y);
    };
    scrollDuringDrag.current = event => {
      if (event.target !== canvasElement && event.target !== wrapperElement) return false;
      if (moved) updateDrop();
      return true;
    };
    const cleanup = () => {
      autoScroll.destroy(); scrollDuringDrag.current = null;
      document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', end);
      cancelDrag.current = null; setDrop(null); setHover(null);
    };
    const end = (e: MouseEvent) => { move(e); cleanup(); if (moved && valid) execute(source, { type: 'table.move', axis, from, to }); };
    cancelDrag.current = cleanup;
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', end);
  };
  const keyboard = (event: React.KeyboardEvent, axis: 'row' | 'column') => {
    if (!hover) return;
    const delta = axis === 'row' ? ({ ArrowUp: -1, ArrowDown: 1 }[event.key]) : ({ ArrowLeft: columnDelta(hover.table.attrs.columnDirection,'left'), ArrowRight: columnDelta(hover.table.attrs.columnDirection,'right') }[event.key]);
    if (!delta) return;
    event.preventDefault(); const from = axis === 'row' ? hover.row : hover.col;
    if (reorderedTable(hover.table, axis, from, from + delta)) execute(hover, { type: 'table.move', axis, from, to: from + delta });
    else toast.info('This move would cross a table edge, pinned header boundary, or merged cell.');
  };
  if (!hover) return null;
  const pinCount = completePinnedBoundary(hover.table, hover.row + 1);
  return createPortal(<>
    <div className="table-hover-tools table-row-tools" style={{ left: hover.x, top: hover.y, visibility: drop ? 'hidden' : undefined }} role="group" aria-label={`Row ${hover.row + 1} actions`}>
      <button aria-label={`Drag row ${hover.row + 1}`} title="Drag row; use Up/Down to move" onMouseDown={e => startDrag(e, 'row')} onKeyDown={e => keyboard(e, 'row')}><GripVertical size={16} /></button>
      <button aria-label={`Pin header through row ${pinCount}`} title={`Pin header through row ${pinCount}`} onMouseDown={e => e.preventDefault()} onClick={() => execute(hover, { type: 'table.pinRows', count: pinCount })}><Pin size={14} /></button>
    </div>
    {hover.showColumn && !drop && <div className="table-hover-tools table-column-tools" style={{ left: hover.cx, top: hover.cy }} role="group" aria-label={`Column ${hover.col + 1} actions`}>
      <button aria-label={`Drag column ${hover.col + 1}`} title="Drag column; use Left/Right to move" onMouseDown={e => startDrag(e, 'column')} onKeyDown={e => keyboard(e, 'column')}><GripHorizontal size={16} /></button>
      <button aria-label={`Sort column ${hover.col + 1} ascending`} title="Sort ascending" onMouseDown={e => e.preventDefault()} onClick={() => execute(hover, { type: 'table.sort', column: hover.col, descending: false })}><ArrowDownAZ size={15} /></button>
      <button aria-label={`Sort column ${hover.col + 1} descending`} title="Sort descending" onMouseDown={e => e.preventDefault()} onClick={() => execute(hover, { type: 'table.sort', column: hover.col, descending: true })}><ArrowUpAZ size={15} /></button>
    </div>}
    {drop && <><div className={`table-drop-line ${drop.valid ? '' : 'invalid'}`} style={{ left: drop.x, top: drop.y, width: drop.axis === 'row' ? drop.length : 3, height: drop.axis === 'row' ? 3 : drop.length }} /><div className="table-drop-status" role="status">{drop.label}</div></>}
  </>, document.body);
}
