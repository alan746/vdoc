import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Editor } from '@tiptap/core';
import { createExtensions } from '../lib/editor/extensions';
import { DocumentEngine } from '../lib/usecases/engine';
import { revealSearchMatch } from '../lib/editor/search/search-scroll';
import { FindPanel } from '../components/editor/editing-panels';

let editor: Editor, engine: DocumentEngine, canvas: HTMLDivElement, root: Root;
const rect = (left: number, top: number, width: number, height: number) =>
  ({ left, top, right: left + width, bottom: top + height, width, height, x: left, y: top, toJSON: () => ({}) });
function dimensions(element: HTMLElement, values: Record<string, number>) {
  for (const [key, value] of Object.entries(values)) Object.defineProperty(element, key, { configurable: true, value });
}
const field = (name: string) => document.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`)!;
async function input(name: string, value: string) {
  const element = field(name); element.focus();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  canvas = document.createElement('div'); canvas.className = 'canvas-scroll'; canvas.style.overflowY = 'auto';
  document.body.appendChild(canvas);
  dimensions(canvas, { clientHeight: 400, scrollHeight: 5000, offsetWidth: 800 });
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(rect(0, 100, 800, 400));
  const mount = document.createElement('div'); canvas.appendChild(mount);
  editor = new Editor({ element: mount, extensions: createExtensions(), content: '<p>Find this</p><p>Find that</p>' });
  await new Promise(resolve => setTimeout(resolve, 0)); engine = new DocumentEngine(editor);
  vi.spyOn(editor.view, 'coordsAtPos').mockImplementation(pos => ({ left: 100, right: 102, top: 1000 + pos - canvas.scrollTop, bottom: 1020 + pos - canvas.scrollTop }));
  const panel = document.createElement('div'); document.body.appendChild(panel); root = createRoot(panel);
  await act(async () => root.render(createElement(FindPanel, { editor, engine, close: () => {} })));
});
afterEach(() => {
  act(() => root.unmount()); engine.destroy(); editor.destroy(); document.body.innerHTML = '';
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
it('reveals the first match while retaining search focus and leaving content/history unchanged', async () => {
  const before = editor.getJSON(), revision = engine.revision;
  await input('Find text', 'Find');
  expect(canvas.scrollTop).toBeGreaterThan(500);
  expect(document.activeElement).toBe(field('Find text'));
  expect(editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to)).toBe('Find');
  expect(editor.getJSON()).toEqual(before); expect(engine.revision).toBe(revision);
});
it('keeps Enter/Shift+Enter navigation in the search input and wraps matches', async () => {
  await input('Find text', 'Find'); const first = editor.state.selection.from;
  await act(async () => field('Find text').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  expect(editor.state.selection.from).toBeGreaterThan(first); expect(document.activeElement).toBe(field('Find text'));
  await act(async () => field('Find text').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true })));
  expect(editor.state.selection.from).toBe(first);
});
it('reveals the next match after replacing without stealing replacement input focus', async () => {
  await input('Find text', 'Find'); await input('Replace with', 'Changed'); canvas.scrollTop = 0;
  const replace = [...document.querySelectorAll('button')].find(button => button.textContent === 'Replace')!;
  await act(async () => replace.click());
  expect(editor.state.doc.textContent).toBe('Changed thisFind that');
  expect(canvas.scrollTop).toBeGreaterThan(500); expect(document.activeElement).toBe(field('Replace with'));
  expect(editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to)).toBe('Find');
});
it('does not move the canvas for an already visible match or an absent query', async () => {
  vi.mocked(editor.view.coordsAtPos).mockReturnValue({ left: 100, right: 102, top: 220, bottom: 240 });
  await input('Find text', 'Find'); expect(canvas.scrollTop).toBe(0);
  await input('Find text', 'Absent'); expect(canvas.scrollTop).toBe(0);
});
it('scrolls a zoomed horizontal wrapper before positioning the outer canvas', () => {
  const wrapper = document.createElement('div'); wrapper.style.overflowX = 'auto';
  canvas.appendChild(wrapper); wrapper.appendChild(editor.view.dom);
  dimensions(wrapper, { clientWidth: 400, scrollWidth: 1200, offsetWidth: 400 });
  vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue(rect(100, 1000, 200, 100));
  vi.mocked(editor.view.coordsAtPos).mockImplementation(() => ({ left: 700 - wrapper.scrollLeft * .5, right: 702 - wrapper.scrollLeft * .5, top: 1050 - canvas.scrollTop, bottom: 1070 - canvas.scrollTop }));
  const before = editor.getJSON(); revealSearchMatch(editor, 1);
  expect(wrapper.scrollLeft).toBe(1002); expect(canvas.scrollTop).toBe(760); expect(editor.getJSON()).toEqual(before);
});
it('does not scroll arbitrary page ancestors when the editor is outside its canvas', () => {
  document.body.appendChild(editor.view.dom); revealSearchMatch(editor, 1); expect(canvas.scrollTop).toBe(0);
});

it('keeps the active match visible while the search input owns focus and clears decorations on close', async () => {
  const before = editor.getJSON(), revision = engine.revision, html = editor.getHTML();
  await input('Find text', 'Find');
  expect(editor.view.dom.querySelectorAll('.vdoc-search-match')).toHaveLength(2);
  expect(editor.view.dom.querySelector('.vdoc-search-current')?.parentElement?.textContent).toBe('Find this');
  await act(async () => field('Find text').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  expect(editor.view.dom.querySelectorAll('.vdoc-search-current')).toHaveLength(1);
  expect(editor.view.dom.querySelector('.vdoc-search-current')?.parentElement?.textContent).toBe('Find that');
  expect(document.activeElement).toBe(field('Find text'));
  expect(editor.getJSON()).toEqual(before); expect(editor.getHTML()).toBe(html); expect(engine.revision).toBe(revision); expect(engine.canUndo).toBe(false);
  await act(async () => root.render(null));
  expect(editor.view.dom.querySelector('.vdoc-search-match')).toBeNull();
});
it('clears old highlights when no matches remain and preserves formatting across a split match', async () => {
  act(() => { editor.commands.setContent('<p><strong>Fi</strong>nd this</p>'); });
  await input('Find text', 'Find');
  expect([...editor.view.dom.querySelectorAll('.vdoc-search-current')].map(node => node.textContent).join('')).toBe('Find');
  expect(editor.getHTML()).toContain('<strong>Fi</strong>nd this');
  await input('Find text', 'Absent');
  expect(editor.view.dom.querySelector('.vdoc-search-match')).toBeNull();
});
it('updates decorations after replace without adding a separate undo step', async () => {
  const before = editor.getJSON();
  await input('Find text', 'Find'); await input('Replace with', 'Changed');
  const replace = [...document.querySelectorAll('button')].find(button => button.textContent === 'Replace')!;
  await act(async () => replace.click());
  expect(editor.view.dom.querySelectorAll('.vdoc-search-match')).toHaveLength(1);
  expect(editor.view.dom.querySelector('.vdoc-search-current')?.textContent).toBe('Find');
  await act(async () => { engine.history('undo'); });
  expect(editor.getJSON()).toEqual(before); expect(engine.canUndo).toBe(false);
});
it.each([{ isComposing: true }, { keyCode: 229 }])('leaves candidate confirmation and cancellation to the input method: %j', async flags => {
  const close = vi.fn();
  await act(async () => root.render(createElement(FindPanel, { editor, engine, close })));
  await input('Find text', 'Find'); const position = editor.state.selection.from;
  for (const key of ['Enter', 'Escape']) {
    const event = new KeyboardEvent('keydown', { key, ...flags, bubbles: true, cancelable: true });
    await act(async () => field('Find text').dispatchEvent(event));
    expect(event.defaultPrevented).toBe(false);
  }
  expect(editor.state.selection.from).toBe(position); expect(close).not.toHaveBeenCalled();
});
it('centers inside the visible viewport when the canvas extends below it', () => {
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(rect(0, 100, 800, 1200));
  vi.stubGlobal('visualViewport', { offsetTop: 200, height: 300, offsetLeft: 0, width: 800 });
  vi.mocked(editor.view.coordsAtPos).mockImplementation(() => ({ left: 100, right: 102, top: 900 - canvas.scrollTop, bottom: 920 - canvas.scrollTop }));
  revealSearchMatch(editor, 1);
  expect(canvas.scrollTop).toBe(560);
});
it('rechecks visibility after delayed browser scrolling without taking input focus', async () => {
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.push(callback); return frames.length; });
  await input('Find text', 'Find'); const expected = canvas.scrollTop;
  canvas.scrollTop = 0;
  await act(async () => frames.at(-1)!(0));
  expect(canvas.scrollTop).toBe(expected); expect(document.activeElement).toBe(field('Find text'));
});

function pinnedTable(headerHeight: number) {
  act(() => { editor.commands.setContent('<table><tr><th><p>Header</p></th></tr><tr><td><p>Find below headers</p></td></tr></table>'); });
  const table = editor.view.dom.querySelector('table')!;
  const header = table.rows[0]; header.classList.add('vdoc-pinned-row');
  vi.spyOn(header, 'getBoundingClientRect').mockReturnValue(rect(0, 100, 800, headerHeight));
  let target = 0, headerTarget = 0;
  editor.state.doc.descendants((node, pos) => {
    if (node.isText && node.text?.startsWith('Find')) target = pos;
    if (node.isText && node.text === 'Header') headerTarget = pos;
  });
  return { target, headerTarget };
}
it.each([0, 600])('reveals a body match below a tall pinned header from scroll position %s', scroll => {
  const { target } = pinnedTable(240), before = editor.getJSON();
  canvas.scrollTop = scroll;
  vi.mocked(editor.view.coordsAtPos).mockImplementation(() => ({left:100,right:102,top:890-canvas.scrollTop,bottom:910-canvas.scrollTop}));
  revealSearchMatch(editor, target);
  const point = editor.view.coordsAtPos(target);
  expect(point.top).toBeGreaterThanOrEqual(348);
  expect(point.bottom).toBeLessThanOrEqual(476);
  expect(editor.getJSON()).toEqual(before);
});
it('does not move a match inside the pinned header out of its visible position', () => {
  const { headerTarget } = pinnedTable(240);
  vi.mocked(editor.view.coordsAtPos).mockReturnValue({left:100,right:102,top:220,bottom:240});
  revealSearchMatch(editor, headerTarget); expect(canvas.scrollTop).toBe(0);
});
it('does not reserve space for oversized headers that scroll normally', () => {
  const { target } = pinnedTable(450);
  vi.mocked(editor.view.coordsAtPos).mockReturnValue({left:100,right:102,top:220,bottom:240});
  revealSearchMatch(editor, target); expect(canvas.scrollTop).toBe(0);
});
