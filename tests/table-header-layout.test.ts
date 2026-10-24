import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { createExtensions } from '../lib/editor/extensions';

let editor: Editor, canvas: HTMLElement, paper: HTMLElement;
let frames: Map<number, FrameRequestCallback>, sequence: number;
let tables: HTMLTableElement[], tops: number[], events: string[];
const rect = (top: number, height: number, width = 300) => ({ top, bottom: top + height, height, width, left: 0, right: width, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
function tick() {
  const callbacks = [...frames.values()]; frames.clear();
  for (const callback of callbacks) callback(0);
}
const reads = () => events.filter(event => event.startsWith('read:'));
const scroll = () => { canvas.dispatchEvent(new Event('scroll')); tick(); };
class Observer {
  static instances: Observer[] = [];
  targets = new Set<Element>();
  constructor(readonly callback: () => void) { Observer.instances.push(this); }
  observe(target: Element) { this.targets.add(target); }
  unobserve(target: Element) { this.targets.delete(target); }
  disconnect() { this.targets.clear(); }
}

beforeEach(async () => {
  frames = new Map(); sequence = 0; events = []; Observer.instances = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++sequence, callback); return sequence; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal('ResizeObserver', Observer);
  canvas = document.createElement('div'); canvas.className = 'canvas-scroll';
  paper = document.createElement('div'); paper.className = 'paper-wrap'; canvas.appendChild(paper);
  const ruler = document.createElement('div'); ruler.className = 'paragraph-ruler'; paper.appendChild(ruler);
  const mount = document.createElement('div'); paper.appendChild(mount); document.body.appendChild(canvas);
  canvas.getBoundingClientRect = () => { events.push('read:canvas'); return rect(100, 600); };
  ruler.getBoundingClientRect = () => { events.push('read:ruler'); return rect(100, 40); };
  const table = (header: boolean) => `<table><tr><${header ? 'th' : 'td'}>Heading</${header ? 'th' : 'td'}></tr><tr><td>Body</td></tr></table>`;
  editor = new Editor({ element: mount, extensions: createExtensions(), content: '<p>Before</p>' + table(true) + table(true) + table(false) });
  await new Promise(resolve => setTimeout(resolve, 0));
  tables = [...editor.view.dom.querySelectorAll('table')]; tops = [80, 260, 500];
  tables.forEach((table, index) => {
    table.getBoundingClientRect = () => { events.push(`read:table${index}`); return rect(tops[index], 400); };
    Object.defineProperty(table, 'offsetWidth', { configurable: true, get: () => { events.push(`read:width${index}`); return 300; } });
    table.rows[0].getBoundingClientRect = () => { events.push(`read:row${index}`); return rect(tops[index], 30); };
    const set = table.style.setProperty.bind(table.style);
    vi.spyOn(table.style, 'setProperty').mockImplementation((...args) => { events.push(`write:table${index}`); return set(...args); });
    const toggle = table.classList.toggle.bind(table.classList);
    vi.spyOn(table.classList, 'toggle').mockImplementation((...args) => { events.push(`write:class${index}`); return toggle(...args); });
  });
  tick(); events = [];
});
afterEach(() => { editor.destroy(); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('does no table layout work for twenty caret-only changes', () => {
  for (let i = 0; i < 20; i++) { editor.commands.setTextSelection(1 + i % 5); tick(); }
  expect(reads()).toEqual([]);
});

it('reads all table geometry before applying offsets, retaining clamping and viewport rules', () => {
  tops = [-400, 100, 500]; scroll();
  const firstWrite = events.findIndex(event => event.startsWith('write:'));
  expect(firstWrite).toBeGreaterThan(0);
  expect(events.slice(firstWrite).filter(event => event.startsWith('read:'))).toEqual([]);
  expect(tables[0].style.getPropertyValue('--vdoc-pin-offset')).toBe('370px');
  expect(tables[1].style.getPropertyValue('--vdoc-pin-offset')).toBe('40px');
  expect(tables[0].classList.contains('vdoc-header-stuck')).toBe(true);
});

it('does not measure an unpinned table but resets its old sticky state', () => {
  tables[2].style.setProperty('--vdoc-pin-offset', '100px'); tables[2].classList.add('vdoc-header-stuck');
  events = []; scroll();
  expect(reads().filter(event => /(?:table|width|row)2$/.test(event))).toEqual([]);
  expect(tables[2].style.getPropertyValue('--vdoc-pin-offset')).toBe('0px');
  expect(tables[2].classList.contains('vdoc-header-stuck')).toBe(false);
});

it('does no geometry reads when the document has no pinned rows', () => {
  editor.commands.setContent('<p>Before</p><table data-pinned-rows="0"><tr><th>Unpinned</th></tr></table>'); tick();
  events = []; scroll();
  expect(reads()).toEqual([]);
});

it('does not write unchanged offsets or classes on repeated scrolling', () => {
  scroll(); scroll();
  expect(reads()).toContain('read:table0');
  expect(events.filter(event => event.startsWith('write:'))).toEqual([]);
});

it('clears sticky offsets when a header becomes taller than the viewport', () => {
  tables[0].rows[0].getBoundingClientRect = () => rect(tops[0], 700);
  scroll();
  expect(tables[0].style.getPropertyValue('--vdoc-pin-offset')).toBe('0px');
  expect(tables[0].classList.contains('vdoc-header-stuck')).toBe(false);
});

it('still remeasures after an edit, a resize, and a zoom mutation', async () => {
  editor.view.dispatch(editor.state.tr.insertText('字', 1)); tick();
  expect(reads()).toContain('read:table0');
  events = []; tops[0] = 100;
  for (const observer of Observer.instances) observer.callback(); tick();
  expect(tables[0].style.getPropertyValue('--vdoc-pin-offset')).toBe('40px');
  expect(reads()).toContain('read:table0');
  events = []; tops[0] = 120; paper.setAttribute('style', 'zoom: 1.25');
  await Promise.resolve(); tick();
  expect(reads()).toContain('read:table0');
  expect(tables[0].style.getPropertyValue('--vdoc-pin-offset')).toBe('20px');
});

it('removes detached table observations and cancels pending work on destroy', () => {
  editor.commands.setContent('<p>No tables</p>'); tick();
  expect(Observer.instances.some(observer => observer.targets.has(tables[0]))).toBe(false);
  events = []; canvas.dispatchEvent(new Event('scroll')); editor.destroy(); tick();
  expect(reads()).toEqual([]);
  expect(Observer.instances.every(observer => observer.targets.size === 0)).toBe(true);
});
