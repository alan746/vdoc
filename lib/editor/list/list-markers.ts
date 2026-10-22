import { validNumberAffix, validBulletText } from '../../domain/rules/list-markers';
export { validNumberAffix, validBulletText };
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
