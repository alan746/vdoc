import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Editor } from '@tiptap/core';
import { createExtensions } from '../lib/editor/extensions';
import { DocumentEngine } from '../lib/editor/engine';
import { ParagraphRuler } from '../components/editor/paragraph-ruler';
let editor: Editor, engine: DocumentEngine, root: Root, scale: number;
let frames: Map<number, FrameRequestCallback>, nextFrame: number;
const rect = (left: number, width: number) => ({ x: left, y: 0, left, top: 0, right: left + width, bottom: 40, width, height: 40, toJSON: () => ({}) }) as DOMRect;
function tick() { act(() => { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn(0)); }); }
function control(name = 'Paragraph start indent') { return document.querySelector(`[aria-label="${name}"]`)! as HTMLButtonElement; }
function pointer(type: string, x: number, name?: string) { act(() => { const e = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x }); Object.defineProperty(e, 'pointerId', { value: 1 }); control(name).dispatchEvent(e); }); }
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); frames = new Map(); nextFrame = 0; scale = 1;
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { const id = ++nextFrame; frames.set(id, fn); return id; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const mount = document.createElement('div'); document.body.appendChild(mount);
  editor = new Editor({ element: mount, extensions: createExtensions(), content: '<p>First line<br>Second line</p>' });
  await new Promise(r => setTimeout(r, 0)); engine = new DocumentEngine(editor);
  const geometry = () => { const p = editor.view.dom.querySelector('p')!; p.getBoundingClientRect = () => rect(100 * scale, 500 * scale); };
  geometry(); editor.on('transaction', geometry);
  const reactMount = document.createElement('div'); document.body.appendChild(reactMount); root = createRoot(reactMount);
  await act(async () => { root.render(createElement(ParagraphRuler, { editor, engine, zoom: 100 })); });
  const ruler = document.querySelector('.paragraph-ruler')! as HTMLElement;
  Object.defineProperty(ruler, 'offsetWidth', { value: 700 }); ruler.getBoundingClientRect = () => rect(0, 700 * scale); tick();
  for (const button of document.querySelectorAll('.ruler-handle')) {
    let captured = false; (button as HTMLElement).setPointerCapture = () => { captured = true; };
    (button as HTMLElement).hasPointerCapture = () => captured; (button as HTMLElement).releasePointerCapture = () => { captured = false; };
  }
});
afterEach(() => { act(() => root.unmount()); engine.destroy(); editor.destroy(); document.body.innerHTML = ''; vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it.each([0.75, 1, 2])('previews without writes then commits once at zoom %s with exact Undo/Redo', zoom => {
  scale = zoom; const before = editor.getJSON(), revision = engine.revision;
  pointer('pointerdown', 100); pointer('pointermove', 100 + 40 * scale);
  expect(editor.getJSON()).toEqual(before); expect(engine.revision).toBe(revision);
  expect(document.querySelector('.ruler-guide')!.textContent).toBe('40 px');
  pointer('pointerup', 100 + 40 * scale);
  expect(editor.state.doc.firstChild!.attrs.indentStart).toBe(40); expect(engine.records).toHaveLength(1);
  const after = editor.getJSON(); act(() => { engine.history('undo', 'api'); }); expect(editor.getJSON()).toEqual(before);
  act(() => { engine.history('redo', 'api'); }); expect(editor.getJSON()).toEqual(after);
});
it.each(['Escape', 'pointercancel', 'lostpointercapture', 'blur', 'scroll'])('cancels on %s without document/history changes', reason => {
  const before = editor.getJSON(); pointer('pointerdown', 100); pointer('pointermove', 140);
  act(() => {
    if (reason === 'Escape') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    else if (reason === 'blur') window.dispatchEvent(new Event('blur'));
    else if (reason === 'scroll') document.dispatchEvent(new Event('scroll'));
    else control().dispatchEvent(new Event(reason));
  });
  pointer('pointerup', 140); expect(editor.getJSON()).toEqual(before); expect(engine.records).toHaveLength(0); expect(document.querySelector('.ruler-guide')).toBeNull();
});
it('abandons a drag when another edit changes the document', () => {
  pointer('pointerdown', 100); pointer('pointermove', 140);
  act(() => { engine.execute({ operations: [{ type: 'text.insert', text: 'New text' }] }); });
  const newer = editor.getJSON(); pointer('pointerup', 140); expect(editor.getJSON()).toEqual(newer); expect(engine.records).toHaveLength(1);
});
it('keeps keyboard focus and uses physical arrows for RTL; Shift and Alt have distinct steps', () => {
  // jsdom does not resolve HTML dir into computed CSS direction.
  const computed = window.getComputedStyle;
  vi.spyOn(window, 'getComputedStyle').mockImplementation(el => { const style = computed(el); Object.defineProperty(style, 'direction', { value: 'rtl' }); return style; });
  const button = control();
  act(() => { button.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, bubbles: true })); });
  expect(editor.state.doc.firstChild!.attrs.indentStart).toBe(10); expect(document.activeElement).toBe(button);
  act(() => { button.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true })); });
  expect(editor.state.doc.firstChild!.attrs.indentStart).toBe(10.25);
});
it('clicking a marker without moving it does not create an edit', () => {
  const before = editor.getJSON(); pointer('pointerdown', 100); pointer('pointerup', 100);
  expect(editor.getJSON()).toEqual(before); expect(engine.records).toHaveLength(0);
});
