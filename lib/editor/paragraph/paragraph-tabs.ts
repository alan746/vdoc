import type { Editor } from '@tiptap/core';
import { selectedParagraphs } from './paragraph-selection';
import { paragraphIndent } from './paragraph-indent';

import { DEFAULT_TAB_INTERVAL, validTabInterval } from '../../domain/rules/tab-interval';
export { DEFAULT_TAB_INTERVAL, validTabInterval };
export const preserveTabWhitespace = (el: HTMLElement) => el.hasAttribute('data-tab-interval') || /pre/.test(el.style.whiteSpace) ? null : false;
export function tabIntervalAttribute() {
  return {
    default: DEFAULT_TAB_INTERVAL,
    parseHTML: (el: HTMLElement) => {
      const raw = el.getAttribute('data-tab-interval'), css = el.style.tabSize.match(/^(\d+)px$/);
      const value = raw === null ? css ? Number(css[1]) : NaN : Number(raw);
      return validTabInterval(value) ? value : DEFAULT_TAB_INTERVAL;
    },
    renderHTML: (attrs: Record<string, unknown>) => {
      const value = validTabInterval(attrs.tabInterval) ? attrs.tabInterval : DEFAULT_TAB_INTERVAL;
      // The whitespace rule also preserves real tabs when this HTML is pasted/imported.
      return { 'data-tab-interval': String(value), style: `tab-size:${value}px;white-space:pre-wrap` };
    },
  };
}
export function selectedTabInterval(editor: Editor): number | null {
  const values = selectedParagraphs(editor.state.doc, editor.state.selection).map(({ node }) => node.attrs.tabInterval ?? DEFAULT_TAB_INTERVAL);
  return values.every(v => v === values[0]) ? values[0] ?? DEFAULT_TAB_INTERVAL : null;
}
export function wordTabPositions(attrs: Record<string, any>, listStart = 0) {
  const interval = validTabInterval(attrs.tabInterval) ? attrs.tabInterval : DEFAULT_TAB_INTERVAL;
  const indent = paragraphIndent(attrs), origin = listStart + indent.indentStart + Math.max(0, -indent.firstLineIndent);
  // Native Word tabs are measured from the writing margin; CSS starts at the
  // paragraph content edge. Extend beyond our largest supported paper width.
  return Array.from({ length: Math.ceil(1200 / interval) }, (_, i) => Math.round((origin + (i + 1) * interval) * 15)).filter(n => n > 0);
}
