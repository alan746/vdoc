import { graphemeCount } from './unicode';

const forbidden = /[\p{Cc}\u2028\u2029\u202a-\u202e\u2066-\u2069\uD800-\uDFFF]/u;
export const validNumberAffix = (value: unknown): value is string => typeof value === 'string' && value.length <= 64 && graphemeCount(value) <= 8 && !forbidden.test(value) && !/%[1-9]/.test(value);
export const validBulletText = (value: unknown): value is string => typeof value === 'string' && value.length <= 32 && graphemeCount(value) === 1 && !forbidden.test(value) && !/\s/u.test(value) && /[\p{L}\p{N}\p{P}\p{S}]/u.test(value);
// Escape every code point: text can never terminate a CSS string or declaration.
export const markerCssString = (value: string) => '"' + Array.from(value, c => `\\${c.codePointAt(0)!.toString(16)} `).join('') + '"';
export const LIST_MARKER_CSS = `ol[data-number-prefix] > li::marker{content:var(--vdoc-prefix) counter(list-item,var(--vdoc-counter-style)) var(--vdoc-suffix) " "}ul[data-bullet-text] > li::marker{content:var(--vdoc-bullet) " "}`;

export function numberAffixAttributes() {
  return {
    numberPrefix: {
      default: '',
      parseHTML: (el: HTMLElement) => { const value = el.getAttribute('data-number-prefix'); return validNumberAffix(value) ? value : ''; },
      renderHTML: (attrs: Record<string, unknown>) => {
        const prefix = validNumberAffix(attrs.numberPrefix) ? attrs.numberPrefix : '', suffix = validNumberAffix(attrs.numberSuffix) ? attrs.numberSuffix : '.';
        return prefix !== '' || suffix !== '.' ? { 'data-number-prefix': prefix, 'data-number-suffix': suffix, style: `--vdoc-prefix:${markerCssString(prefix)};--vdoc-suffix:${markerCssString(suffix)}` } : {};
      },
    },
    numberSuffix: { default: '.', parseHTML: (el: HTMLElement) => { const value = el.getAttribute('data-number-suffix'); return validNumberAffix(value) ? value : '.'; }, renderHTML: () => ({}) },
  };
}
export function bulletTextAttribute() {
  return {
    default: null,
    parseHTML: (el: HTMLElement) => { const value = el.getAttribute('data-bullet-text'); return validBulletText(value) ? value : null; },
    renderHTML: (attrs: Record<string, unknown>) => validBulletText(attrs.bulletText) ? { 'data-bullet-text': attrs.bulletText, style: `--vdoc-bullet:${markerCssString(attrs.bulletText)}` } : {},
  };
}
