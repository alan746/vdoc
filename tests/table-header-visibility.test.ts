import { Editor } from '@tiptap/core';
import { afterEach, expect, it, vi } from 'vitest';
import { createExtensions } from '../lib/editor/extensions';
import { tableRowVisualRect } from '../lib/editor/table/table-headers';

let editor: Editor | undefined;
afterEach(() => { editor?.destroy(); editor = undefined; document.body.replaceChildren(); vi.restoreAllMocks(); });

it('uses translated pinned-cell coordinates without treating a rowspan as the row height', () => {
  const row = document.createElement('tr');
  const cell = document.createElement('th'); cell.rowSpan = 2; row.appendChild(cell);
  vi.spyOn(row, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, -200, 400, 40));
  vi.spyOn(cell, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 160, 200, 80));
  expect(tableRowVisualRect(row)).toMatchObject({ top: -200, bottom: -160, height: 40 });
  row.classList.add('vdoc-pinned-row');
  expect(tableRowVisualRect(row)).toMatchObject({ top: 160, bottom: 200, height: 40 });
});

function layout(scale: number, headerHeight: number) {
  const frames = new Map<number, FrameRequestCallback>(); let id = 0;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.set(++id, callback); return id; });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(key => { frames.delete(key); });
  const canvas = document.createElement('div'); canvas.className = 'canvas-scroll'; document.body.appendChild(canvas);
  const ruler = document.createElement('div'); ruler.className = 'paragraph-ruler'; canvas.appendChild(ruler);
  const mount = document.createElement('div'); canvas.appendChild(mount);
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 800, 400));
  vi.spyOn(ruler, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 800, 42 * scale));
  editor = new Editor({ element: mount, extensions: createExtensions(), content: '<table><tr><th>Header 中文</th></tr><tr><td>Body العربية</td></tr></table>' });
  const table = editor.view.dom.querySelector('table')!, row = table.rows[0];
  Object.defineProperty(table, 'offsetWidth', { configurable: true, value: 400 });
  vi.spyOn(table, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, -100, 400 * scale, 1000 * scale));
  vi.spyOn(row, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, -100 + parseFloat(table.style.getPropertyValue('--vdoc-pin-offset') || '0') * scale, 400 * scale, headerHeight));
  const before = editor.getJSON();
  [...frames.values()].forEach(callback => callback(0)); frames.clear();
  return { table, row, ruler, before };
}

it.each([.75, 1, 1.25])('keeps the pinned header below the ruler at %s zoom without changing document data', scale => {
  const { table, row, ruler, before } = layout(scale, 100 * scale);
  expect(table.classList.contains('vdoc-header-stuck')).toBe(true);
  expect(row.getBoundingClientRect().top).toBeCloseTo(ruler.getBoundingClientRect().bottom);
  expect(editor!.getJSON()).toEqual(before);
});

it('lets headers taller than the space below the ruler scroll normally', () => {
  const { table, row, before } = layout(1, 380);
  expect(table.classList.contains('vdoc-header-stuck')).toBe(false);
  expect(row.getBoundingClientRect().top).toBe(-100);
  expect(editor!.getJSON()).toEqual(before);
});
