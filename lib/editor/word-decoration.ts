import { paragraphBorderEdges, type ParagraphBorders } from './paragraph-borders';
import type { WordParagraphProperties } from './word-paragraph-spacing';
import type { WordAttributes, WordTheme } from './word-theme';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
export const wordAttributes = (element?: Element): WordAttributes | undefined => element ? Object.fromEntries(Array.from(element.attributes).filter(a => a.namespaceURI === W).map(a => [a.localName, a.value])) : undefined;
const warn = (warnings: string[], message: string) => { if (!warnings.includes(message)) warnings.push(message); };

/** Resolve the supported solid appearance; patterned shading remains an explicit approximation. */
export function wordShading(attrs: WordAttributes | undefined, theme: WordTheme, warnings: string[]): string | undefined {
  if (!attrs || attrs.val === 'nil') return;
  const pattern = attrs.val || 'clear';
  if (!['clear', 'solid'].includes(pattern)) warn(warnings, 'Some Word shading patterns cannot be reproduced. Only their background color is retained; review paragraph, cell and text shading.');
  const color = pattern === 'solid' ? theme.color({ ...attrs, val: attrs.color }) : theme.color(attrs, true);
  const raw = pattern === 'solid' ? attrs.color : attrs.fill;
  if (!color && (pattern === 'solid' || raw && raw !== 'auto')) warn(warnings, 'Some Word shading colors are automatic, invalid or unsupported. Review paragraph, cell and text shading.');
  return color;
}

export function restoreParagraphDecoration(target: HTMLElement, values: WordParagraphProperties, theme: WordTheme, warnings: string[]) {
  if (values.shd) target.style.backgroundColor = wordShading(values.shd, theme, warnings) || '';
  if (!values.borders) return;
  const unsupported = () => warn(warnings, 'Some Word paragraph border styles, effects or dimensions are unsupported. Review paragraph borders after import.');
  const borders: ParagraphBorders = {};
  if (values.borders.bar && !['nil', 'none'].includes(values.borders.bar.val)) unsupported();
  for (const side of paragraphBorderEdges) {
    const edge = values.borders[side];
    if (!edge || ['nil', 'none'].includes(edge.val)) continue;
    const size = Number(edge.sz), space = Number(edge.space ?? '0');
    if (!['single', 'dashed', 'dotted'].includes(edge.val) || !/^\d+$/.test(edge.sz || '') || size <= 0 || size > 48 || !/^\d+$/.test(edge.space ?? '0') || space > 31) { unsupported(); continue; }
    if (['shadow', 'frame'].some(key => ['1', 'true', 'on'].includes(edge[key]))) unsupported();
    const color = theme.color({ ...edge, val: edge.color });
    if (!color && edge.color && edge.color !== 'auto') unsupported();
    borders[side] = { width: size / 6, padding: space, style: edge.val === 'single' ? 'solid' : edge.val as 'dashed' | 'dotted', color: color || '#334155' };
  }
  // The explicit between element, including nil, carries Word's adjacent-frame
  // semantics. Keep that flag even when the separator itself is suppressed.
  if (values.borders.between) target.setAttribute('data-paragraph-border-join', 'true');
  if (Object.keys(borders).length) target.setAttribute('data-paragraph-borders', JSON.stringify(borders));
}
