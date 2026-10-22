import type { Editor } from '@tiptap/core';
import { pinnedHeaderViewport } from './table-headers';

/** Reveal a match without moving focus away from the find/replace inputs. */
export function revealSearchMatch(editor: Editor, from: number) {
  if (editor.isDestroyed || from < 0 || from > editor.state.doc.content.size) return;
  const canvas = editor.view.dom.closest<HTMLElement>('.canvas-scroll');
  if (!canvas) return;
  const dom = editor.view.domAtPos(from).node;
  let element = dom instanceof HTMLElement ? dom : dom.parentElement;
  const matchElement = element;
  while (element && canvas.contains(element)) {
    const style = getComputedStyle(element);
    const horizontal = /auto|scroll/.test(style.overflowX) && element.scrollWidth > element.clientWidth;
    const vertical = /auto|scroll/.test(style.overflowY) && element.scrollHeight > element.clientHeight;
    if (horizontal || vertical) {
      // Re-read after scrolling each nested wrapper (including wide tables).
      const highlight = editor.view.dom.querySelector<HTMLElement>(`.vdoc-search-current[data-search-from="${from}"]`);
      const mark = highlight?.getClientRects()[0];
      const point = mark && mark.height > 0 ? mark : editor.view.coordsAtPos(from), box = element.getBoundingClientRect();
      const scale = element.offsetWidth ? box.width / element.offsetWidth : 1;
      const viewport = window.visualViewport;
      const left = Math.max(box.left, viewport?.offsetLeft || 0), right = Math.min(box.right, (viewport?.offsetLeft || 0) + (viewport?.width || window.innerWidth));
      const top = Math.max(box.top, viewport?.offsetTop || 0), bottom = Math.min(box.bottom, (viewport?.offsetTop || 0) + (viewport?.height || window.innerHeight));
      if (horizontal && right > left && (point.left < left + 24 || point.right > right - 24)) {
        element.scrollLeft += ((point.left + point.right - left - right) / 2) / (scale || 1);
      }
      const rulerHeight = element === canvas ? canvas.querySelector('.paragraph-ruler')?.getBoundingClientRect().height || 0 : 0;
      let visibleTop = top;
      if (element === canvas) {
        const headerViewport = pinnedHeaderViewport(canvas, window);
        // Pinning updates on the next animation frame. Reserve the header's
        // eventual position, even if it is not stuck yet, so the revealed match
        // cannot disappear behind it immediately after this scroll.
        for (let table = matchElement?.closest('table'); table; table = table.parentElement?.closest('table')) {
          const rows = Array.from(table.rows).filter(row => row.classList.contains('vdoc-pinned-row'));
          if (rows.some(row => row.contains(matchElement))) continue;
          const height = rows.reduce((sum, row) => sum + row.getBoundingClientRect().height, 0);
          // Match the pinning extension: oversized headers scroll normally.
          if (height > 0 && height < headerViewport.height) visibleTop = Math.max(visibleTop, headerViewport.top + height + 8);
        }
      }
      const safeTop = Math.max(visibleTop, top + Math.max(48, rulerHeight + 8));
      if (vertical && bottom > visibleTop && (point.top < safeTop || point.bottom > bottom - 24)) {
        element.scrollTop += ((point.top + point.bottom - visibleTop - bottom) / 2) / (scale || 1);
      }
    }
    if (element === canvas) break;
    element = element.parentElement;
  }
}
