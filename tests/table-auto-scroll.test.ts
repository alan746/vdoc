import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createTableAutoScroll, edgeScrollSpeed } from '../lib/editor/table-auto-scroll';
let canvas: HTMLElement, wrapper: HTMLElement, table: HTMLElement;
let callbacks: Map<number, FrameRequestCallback>, nextId: number;
const frames = { request: (fn: FrameRequestCallback) => { const id = ++nextId; callbacks.set(id, fn); return id; }, cancel: (id: number) => { callbacks.delete(id); } };
function step(time: number) { const pending = [...callbacks.values()]; callbacks.clear(); pending.forEach(fn => fn(time)); }
function rect(left: number, top: number, width: number, height: number) { return { left, right: left + width, top, bottom: top + height, width, height } as DOMRect; }
function metrics(el: HTMLElement, values: Record<string, number>) { for (const [key, value] of Object.entries(values)) Object.defineProperty(el, key, { configurable: true, value }); }
beforeEach(() => {
  callbacks = new Map(); nextId = 0;
  canvas = document.createElement('div'); wrapper = document.createElement('div'); table = document.createElement('table');
  document.body.appendChild(canvas); canvas.appendChild(wrapper); wrapper.appendChild(table);
  canvas.getBoundingClientRect = () => rect(0,100,600,500);
  wrapper.getBoundingClientRect = () => rect(80,200-canvas.scrollTop,400,1200);
  table.getBoundingClientRect = () => rect(80-wrapper.scrollLeft,200-canvas.scrollTop,1200,1200);
  metrics(canvas,{ scrollHeight:1800,clientHeight:500 });
  metrics(wrapper,{ scrollWidth:1200,clientWidth:400,offsetWidth:400 });
});
afterEach(() => { document.body.innerHTML=''; });
it('accelerates near edges, has a neutral middle, and stops outside the tolerance', () => {
  expect(edgeScrollSpeed(350,100,600)).toBe(0); expect(edgeScrollSpeed(100,100,600)).toBe(-720); expect(edgeScrollSpeed(600,100,600)).toBe(720);
  expect(edgeScrollSpeed(580,100,600)).toBeGreaterThan(edgeScrollSpeed(560,100,600));
  expect(edgeScrollSpeed(613,100,600)).toBe(0); expect(edgeScrollSpeed(87,100,600)).toBe(0);
});
it('does not overlap edge zones in a narrow viewport', () => {
  expect(edgeScrollSpeed(130,100,160)).toBe(0); expect(edgeScrollSpeed(110,100,160)).toBeLessThan(0); expect(edgeScrollSpeed(150,100,160)).toBeGreaterThan(0);
  expect(edgeScrollSpeed(100,100,100)).toBe(0);
});
it('keeps scrolling while the pointer is stationary and recomputes the drop after each scroll', () => {
  const changed = vi.fn(), scroller = createTableAutoScroll('row',canvas,wrapper,table,changed,frames);
  scroller.update(120,598); step(100); const first = canvas.scrollTop; expect(first).toBeGreaterThan(0);
  step(116); expect(canvas.scrollTop).toBeGreaterThan(first); expect(changed).toHaveBeenCalledTimes(2);
  scroller.destroy(); expect(callbacks.size).toBe(0);
});
it('stops when the pointer leaves the edge and resumes when it returns', () => {
  const scroller = createTableAutoScroll('row',canvas,wrapper,table,()=>{},frames);
  scroller.update(120,598); step(100); const first = canvas.scrollTop;
  scroller.update(120,350); step(116); expect(canvas.scrollTop).toBe(first); expect(callbacks.size).toBe(0);
  scroller.update(120,598); step(200); expect(canvas.scrollTop).toBeGreaterThan(first); scroller.destroy();
});
it('scrolls upward and stops before passing the table start', () => {
  canvas.scrollTop=200;
  const scroller=createTableAutoScroll('row',canvas,wrapper,table,()=>{},frames); scroller.update(120,101); step(100);
  expect(canvas.scrollTop).toBeLessThan(200); canvas.scrollTop=0; step(116); expect(canvas.scrollTop).toBe(0); expect(callbacks.size).toBe(0); scroller.destroy();
});
it.each([0.75,1,1.25])('converts horizontal movement at scale %s without changing screen speed', scale => {
  wrapper.getBoundingClientRect=()=>rect(80,200,400*scale,300);
  const scroller=createTableAutoScroll('column',canvas,wrapper,table,()=>{},frames);
  scroller.update(80+400*scale,220); step(100);
  expect(wrapper.scrollLeft*scale).toBeCloseTo(12); expect(canvas.scrollTop).toBe(0); scroller.destroy();
});
it('scrolls a wide table back to the left', () => {
  wrapper.scrollLeft=200;
  const scroller=createTableAutoScroll('column',canvas,wrapper,table,()=>{},frames); scroller.update(80,220); step(100);
  expect(wrapper.scrollLeft).toBe(188); scroller.destroy();
});
it('stops at the scroll limit without scheduling a busy loop', () => {
  wrapper.scrollLeft=799;
  const scroller=createTableAutoScroll('column',canvas,wrapper,table,()=>{},frames); scroller.update(480,220); step(100);
  expect(wrapper.scrollLeft).toBe(800); step(116); expect(callbacks.size).toBe(0); scroller.destroy();
});
it('does not scroll another axis or a table outside the pointer lane', () => {
  const rows=createTableAutoScroll('row',canvas,wrapper,table,()=>{},frames); rows.update(590,598); step(100); expect(canvas.scrollTop).toBe(0); rows.destroy();
  const cols=createTableAutoScroll('column',canvas,wrapper,table,()=>{},frames); cols.update(480,120); step(100); expect(wrapper.scrollLeft).toBe(0); cols.destroy();
});
it('caps delayed frames instead of jumping after a suspended tab', () => {
  const scroller=createTableAutoScroll('row',canvas,wrapper,table,()=>{},frames); scroller.update(120,600); step(100); const first=canvas.scrollTop;
  step(10000); expect(canvas.scrollTop-first).toBeCloseTo(720*0.032); scroller.destroy();
});
it('cancels the scheduled frame and ignores future updates after cleanup', () => {
  const scroller=createTableAutoScroll('row',canvas,wrapper,table,()=>{},frames); scroller.update(120,600); scroller.destroy();
  step(100); scroller.update(120,600); expect(callbacks.size).toBe(0); expect(canvas.scrollTop).toBe(0);
});
it('stops if the table is removed or cleanup happens inside the scroll callback', () => {
  const removed=createTableAutoScroll('row',canvas,wrapper,table,()=>{},frames); removed.update(120,600); table.remove(); step(100); expect(callbacks.size).toBe(0); removed.destroy();
  wrapper.appendChild(table);
  const cancelled=createTableAutoScroll('row',canvas,wrapper,table,()=>cancelled.destroy(),frames); cancelled.update(120,600); step(100); expect(callbacks.size).toBe(0);
});
