import type { WordParagraphProperties } from './word-paragraph-spacing';

function warn(warnings: string[], message: string) { if (!warnings.includes(message)) warnings.push(message); }
export function restoreParagraphFlags(target: HTMLElement, values: WordParagraphProperties, warnings: string[]) {
  function flag(name: 'bidi' | 'keepNext' | 'keepLines' | 'widowControl') {
    const value = values[name];
    if (!value) return;
    if (value.val === undefined || ['1', 'true', 'on'].includes(value.val)) return true;
    if (['0', 'false', 'off'].includes(value.val)) return false;
    warn(warnings, 'Some Word paragraph layout settings are unsupported. Review paragraph direction and pagination after import.');
  }
  for (const [name, key] of [['keepNext', 'data-keep-with-next'], ['keepLines', 'data-keep-lines-together'], ['widowControl', 'data-prevent-single-lines']] as const) {
    const value = flag(name); if (value !== undefined) target.setAttribute(key, String(value));
  }
  const bidi = flag('bidi'); if (bidi !== undefined) target.setAttribute('dir', bidi ? 'rtl' : 'ltr');
  let alignment = values.jc?.val;
  if (alignment === 'start') alignment = target.getAttribute('dir') === 'rtl' ? 'right' : 'left';
  if (alignment === 'end') alignment = target.getAttribute('dir') === 'rtl' ? 'left' : 'right';
  if (alignment && ['left', 'right', 'center', 'both'].includes(alignment)) target.style.textAlign = alignment === 'both' ? 'justify' : alignment;
  else if (alignment) warn(warnings, 'Some Word paragraph alignment settings are unsupported. Review alignment after import.');
}

export function restoreParagraphIndent(target: HTMLElement, values: Record<string, string>, listStart: number, warnings: string[]) {
  const unsupported = () => warn(warnings, 'Some Word paragraph indentation uses character-based or unsupported values. Review indentation after import.');
  const rtl = target.getAttribute('dir') === 'rtl';
  function read(key: string, signed = true): number | undefined {
    if (values[`${key}Chars`] !== undefined) { unsupported(); return; }
    const raw = values[key]; if (raw === undefined) return;
    const twips = Number(raw);
    if (!/^-?\d+$/.test(raw) || !Number.isSafeInteger(twips) || Math.abs(twips) > 150000 || !signed && twips < 0) { unsupported(); return; }
    return twips / 15;
  }
  const startKey = values.start !== undefined || values.startChars !== undefined ? 'start' : rtl ? 'right' : 'left';
  const endKey = values.end !== undefined || values.endChars !== undefined ? 'end' : rtl ? 'left' : 'right';
  const start = read(startKey), end = read(endKey);
  const specialKey = values.hanging !== undefined || values.hangingChars !== undefined ? 'hanging' : 'firstLine';
  const offset = read(specialKey, false), special = (offset ?? 0) * (specialKey === 'hanging' ? -1 : 1);
  if (start !== undefined || offset !== undefined) {
    const base = (start ?? 0) - Math.max(0, -special) - listStart;
    if (Math.abs(base) <= 10000 && Number.isFinite(base)) {
      target.setAttribute('data-indent-start', String(base));
      target.setAttribute('data-first-line-indent', String(special));
      target.setAttribute('data-indent-level', String(Math.max(0, Math.round(base / 24))));
    } else unsupported();
  }
  if (end !== undefined) target.setAttribute('data-indent-end', String(end));
  return special;
}
