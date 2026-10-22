import { setEffectiveFormat, effectiveFormatActive } from '../format/format-overrides';
import { applyTextFormat } from '../format/format-copy';
import { findMatches } from '../search/search';
import type { HandlerMap } from './types';

/** Inline text and formatting operations. */
export const textCommands = {
  'format.apply': (op, { state }) => applyTextFormat(state.tr,op.format),
  'text.style': (op, { state, c }) => {
    const s = op.style;
    for (const mark of ['bold', 'italic', 'underline', 'strike'] as const) {
      if (s[mark] !== undefined) {
        if (mark === 'bold' || mark === 'underline') { if (!setEffectiveFormat(state.tr, mark, s[mark]!)) return false; }
        else if (!(s[mark] ? c.setMark(mark) : c.unsetMark(mark))) return false;
      }
    }
    if (s.color !== undefined && !(s.color ? c.setColor(s.color) : c.unsetColor())) return false;
    if (s.highlight !== undefined && !(s.highlight ? c.setHighlight({ color: s.highlight }) : c.unsetHighlight())) return false;
    if (s.fontFamily && !c.setFontFamily(s.fontFamily)) return false;
    if (s.fontSize && !c.setFontSize(`${s.fontSize}px`)) return false;
    if (s.script) {
      c.unsetSuperscript(); c.unsetSubscript();
      if (s.script !== 'normal' && !c.setMark(s.script)) return false;
    }
    return true;
  },
  'text.toggle': (op, { state, c }) => {
    if (op.mark === 'bold' || op.mark === 'underline') return setEffectiveFormat(state.tr, op.mark, !effectiveFormatActive(state, op.mark));
    if (op.mark === 'superscript') c.unsetSubscript();
    if (op.mark === 'subscript') c.unsetSuperscript();
    return c.toggleMark(op.mark);
  },
  'text.insert': (op, { c }) => {
      // Plain text only: never interpret caller-supplied strings as HTML.
      return c.insertContent(op.text.split('\n').flatMap((text, i) => [
        ...(i ? [{ type: 'hardBreak' }] : []), ...(text ? [{ type: 'text', text }] : []),
      ]));
  },
  'text.clear': (_op, { c }) => c.unsetAllMarks(),
  'text.delete': (_op, { state, c }) => !state.selection.empty && c.deleteSelection(),
  'text.replace': (op, { state }) => {
    const { from, to } = state.selection;
    state.tr.insertText(op.text, from, to);
    return true;
  },
  'text.findReplace': (op, { state }) => {
    const matches = findMatches(state.doc, op.query, op.caseSensitive, op.wholeWord);
    if (!matches.length) return false;
    for (const { from, to } of matches.reverse()) state.tr.insertText(op.replacement, from, to);
    return true;
  },
} satisfies HandlerMap<'format.apply' | 'text.style' | 'text.toggle' | 'text.insert' | 'text.clear' | 'text.delete' | 'text.replace' | 'text.findReplace'>;
