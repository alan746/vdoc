'use client';
import { selectedParagraphs } from '@/lib/editor/paragraph/paragraph-selection';
import { useEffect, useId, useRef, useState } from 'react';
import { useLatest } from './use-latest';
import type { Editor } from '@tiptap/core';
import { toast } from 'sonner';
import type { DocumentEngine } from '@/lib/usecases/engine';
import { paragraphIndent } from '@/lib/editor/paragraph/paragraph-indent';
import { adjustRulerIndent, rulerDeltaBounds, rulerPointerDelta, rulerPositions, type RulerHandle, type RulerIndent } from '@/lib/editor/paragraph/paragraph-ruler';

type Paragraph = { value: RulerIndent; left: number; width: number; rtl: boolean };
type Layout = { paragraphs: Paragraph[]; scale: number };
const names = { start: 'Paragraph start indent', firstLine: 'First line indent', end: 'Paragraph end indent' };
const handles: RulerHandle[] = ['firstLine', 'start', 'end'];
const round = (n: number) => Math.round(n * 100) / 100;

function sameLayout(a: Layout | null, b: Layout | null) {
  return a === b || !!a && !!b && a.scale === b.scale && a.paragraphs.length === b.paragraphs.length &&
    a.paragraphs.every((p, i) => {
      const next = b.paragraphs[i];
      return p.left === next.left && p.width === next.width && p.rtl === next.rtl &&
        p.value.indentStart === next.value.indentStart && p.value.indentEnd === next.value.indentEnd &&
        p.value.firstLineIndent === next.value.firstLineIndent;
    });
}

export function ParagraphRuler({ editor, engine, zoom }: { editor: Editor; engine: DocumentEngine; zoom: number }) {
  const root = useRef<HTMLDivElement>(null), cancel = useRef<(() => void) | null>(null);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [preview, setPreview] = useState<{ handle: RulerHandle; delta: number } | null>(null);
  const helpId = useId();
  function measure(): Layout | null {
    if (!root.current || editor.isDestroyed) return null;
    const ruler = root.current.getBoundingClientRect(), scale = ruler.width / root.current.offsetWidth;
    if (!scale || !Number.isFinite(scale)) return null;
    const paragraphs = selectedParagraphs(editor.state.doc, editor.state.selection).flatMap(({ pos, node }) => {
      const element = editor.view.nodeDOM(pos);
      if (!(element instanceof HTMLElement)) return [];
      const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
      const left = (rect.left - ruler.left) / scale - (parseFloat(style.marginLeft) || 0);
      const right = (rect.right - ruler.left) / scale + (parseFloat(style.marginRight) || 0);
      return [{ value: paragraphIndent(node.attrs), left, width: right - left, rtl: style.direction === 'rtl' }];
    });
    return paragraphs.length ? { paragraphs, scale } : null;
  }
  // The listeners below live as long as the editor; they measure with the latest render's closure.
  const latest = useLatest({ measure, layout });
  useEffect(() => {
    let frame = 0;
    const update = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => {
      const next = latest.current.measure();
      // Typing and scrolling often leave the ruler unchanged. Keep measuring
      // for wrapping/table geometry, but only render when its values change.
      if (!sameLayout(latest.current.layout, next)) setLayout(next);
    }); };
    const transaction = () => { cancel.current?.(); update(); };
    const resize = () => { cancel.current?.(); update(); };
    editor.on('transaction', transaction);
    const observer = new ResizeObserver(resize);
    if (root.current) observer.observe(root.current);
    observer.observe(editor.view.dom);
    window.addEventListener('resize', resize);
    document.addEventListener('scroll', resize, true);
    update();
    return () => { cancel.current?.(); cancelAnimationFrame(frame); editor.off('transaction', transaction); observer.disconnect(); window.removeEventListener('resize', resize); document.removeEventListener('scroll', resize, true); };
  }, [editor, engine, zoom, latest]);

  function bounds(current: Layout, handle: RulerHandle) {
    const values = current.paragraphs.map(p => rulerDeltaBounds(p.value, p.width, handle));
    return { min: Math.max(...values.map(v => v.min)), max: Math.min(...values.map(v => v.max)) };
  }
  function commit(handle: RulerHandle, delta: number, revision: number) {
    if (!delta) return;
    const result = engine.execute({ source: 'toolbar', expectedRevision: revision, label: names[handle], operations: [{ type: 'paragraph.adjustIndent', handle, delta }] });
    if (!result.ok) toast.error(result.error);
  }
  function begin(event: React.PointerEvent<HTMLButtonElement>, handle: RulerHandle) {
    if (event.button !== 0 || cancel.current || editor.view.composing) return;
    event.preventDefault();
    const current = measure(); if (!current) return;
    setLayout(current); engine.captureSelection();
    const control = event.currentTarget, pointerId = event.pointerId, origin = event.clientX;
    const revision = engine.revision, limit = bounds(current, handle);
    let delta = 0;
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      delta = Math.max(limit.min, Math.min(limit.max, rulerPointerDelta(e.clientX - origin, current.scale, current.paragraphs[0].rtl, handle, e.altKey)));
      setPreview({ handle, delta });
    };
    const cleanup = () => {
      cancel.current = null;
      control.removeEventListener('pointermove', move); control.removeEventListener('pointerup', up);
      control.removeEventListener('pointercancel', abort); control.removeEventListener('lostpointercapture', abort);
      window.removeEventListener('keydown', key); window.removeEventListener('blur', abort);
      if (control.hasPointerCapture(pointerId)) control.releasePointerCapture(pointerId);
      setPreview(null);
    };
    const abort = () => { cleanup(); engine.clearSelectionBookmark(); };
    const up = (e: PointerEvent) => { if (e.pointerId !== pointerId) return; move(e); cleanup(); commit(handle, delta, revision); engine.clearSelectionBookmark(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); abort(); } };
    cancel.current = abort;
    control.setPointerCapture(pointerId);
    control.addEventListener('pointermove', move); control.addEventListener('pointerup', up);
    control.addEventListener('pointercancel', abort); control.addEventListener('lostpointercapture', abort);
    window.addEventListener('keydown', key); window.addEventListener('blur', abort);
    setPreview({ handle, delta: 0 });
  }
  function keydown(event: React.KeyboardEvent<HTMLButtonElement>, handle: RulerHandle) {
    if (cancel.current || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const current = measure(); if (!current) return;
    const limit = bounds(current, handle), step = event.shiftKey ? 10 : event.altKey ? 0.25 : 1;
    let delta = event.key === 'Home' ? limit.min : event.key === 'End' ? limit.max : ['ArrowUp','ArrowDown'].includes(event.key) ? (event.key === 'ArrowUp' ? step : -step) : rulerPointerDelta(event.key === 'ArrowRight' ? step : -step, 1, current.paragraphs[0].rtl, handle, true);
    delta = Math.max(limit.min, Math.min(limit.max, delta));
    engine.captureSelection(); commit(handle, delta, engine.revision); engine.clearSelectionBookmark();
    // Engine returns focus to the editor for toolbar actions; retain keyboard control here.
    event.currentTarget.focus({ preventScroll: true });
  }
  const active = layout?.paragraphs[0];
  const value = active && preview ? adjustRulerIndent(active.value, preview.handle, preview.delta) : active?.value;
  const positions = value ? rulerPositions(value) : null;
  const x = (handle: RulerHandle) => active && positions ? active.left + (active.rtl ? handle === 'end' ? positions.end : active.width - positions[handle] : handle === 'end' ? active.width - positions.end : positions[handle]) : 0;
  const mixed = layout && layout.paragraphs.some(p => p.rtl !== active?.rtl || JSON.stringify(p.value) !== JSON.stringify(active?.value) || Math.abs(p.left - active!.left) > 1 || Math.abs(p.width - active!.width) > 1);
  return <div ref={root} className="paragraph-ruler" role="group" aria-label="Paragraph ruler">
    <span id={helpId} className="sr-only">Drag a marker and release to apply. Escape cancels. Arrow keys move 1 pixel; Shift moves 10; Alt moves a quarter pixel. Mixed paragraphs move by the same amount in their writing direction.</span>
    {active && positions ? <>
      <div className="ruler-track" style={{ left: active.left, width: active.width }} aria-hidden="true">
        {Array.from({ length: Math.floor(active.width / 24) + 1 }, (_, i) => <span key={i} className={i % 4 === 0 ? 'ruler-tick major' : 'ruler-tick'} style={{ left: active.rtl ? active.width - i * 24 : i * 24 }}>{i % 4 === 0 ? i * 24 : ''}</span>)}
      </div>
      <span className="ruler-unit" aria-hidden="true">px{mixed ? ' · Mixed' : ''}</span>
      {handles.map(handle => { const limit = bounds(layout!, handle); const initial = rulerPositions(active.value)[handle]; return <button key={handle} type="button" role="slider" className={`ruler-handle ruler-${handle}`} style={{ left: x(handle) }} aria-label={names[handle]} aria-describedby={helpId} aria-orientation="horizontal" aria-valuemin={round(initial + limit.min)} aria-valuemax={round(initial + limit.max)} aria-valuenow={round(positions[handle])} aria-valuetext={`${round(positions[handle])} pixels${mixed ? ', mixed selection' : ''}`} title={`${names[handle]}: ${round(positions[handle])} px. Drag or use arrow keys.`} onPointerDown={e => begin(e, handle)} onKeyDown={e => keydown(e, handle)}><span /></button>; })}
      {preview && <div className="ruler-guide" style={{ left: x(preview.handle) }} aria-hidden="true"><span>{round(positions[preview.handle])} px</span></div>}
    </> : <span className="ruler-empty">Select a paragraph to adjust indentation</span>}
  </div>;
}
