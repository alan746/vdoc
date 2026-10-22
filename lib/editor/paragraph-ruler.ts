import { paragraphIndent } from './paragraph-indent';

export type RulerHandle = 'start' | 'firstLine' | 'end';
export type RulerIndent = ReturnType<typeof paragraphIndent>;

export function rulerPositions(value: RulerIndent) {
  const start = value.indentStart + Math.max(0, -value.firstLineIndent);
  return { start, firstLine: start + value.firstLineIndent, end: value.indentEnd };
}

/** Moving the first-line marker leaves the other lines fixed, even across zero. */
export function adjustRulerIndent(value: RulerIndent, handle: RulerHandle, delta: number): RulerIndent {
  if (handle === 'end') return { ...value, indentEnd: value.indentEnd + delta };
  if (handle === 'start') return { ...value, indentStart: value.indentStart + delta };
  const { start, firstLine } = rulerPositions(value);
  return { ...value, indentStart: Math.min(start, firstLine + delta), firstLineIndent: firstLine + delta - start };
}

/** Intersect these bounds for a mixed selection, including narrow table cells. */
export function rulerDeltaBounds(value: RulerIndent, width: number, handle: RulerHandle) {
  const p = rulerPositions(value), farthest = Math.max(p.start, p.firstLine);
  let min: number, max: number;
  if (handle === 'end') { min = -p.end; max = width - farthest - 24 - p.end; }
  else if (handle === 'firstLine') { min = -p.firstLine; max = width - p.end - 24 - p.firstLine; }
  else { min = -Math.min(p.start, p.firstLine); max = width - p.end - 24 - farthest; }
  // Imported outdents/overflow can be moved back in without a jump on pointerdown.
  return { min: Math.min(0, min), max: Math.max(0, max) };
}

export function rulerPointerDelta(dx: number, scale: number, rtl: boolean, handle: RulerHandle, fine = false) {
  const step = fine ? 0.25 : 1;
  return Math.round(dx / scale * (rtl ? -1 : 1) * (handle === 'end' ? -1 : 1) / step) * step;
}
