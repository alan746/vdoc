import { absoluteLengthPixels } from './font-size';

/** Word uses 240ths of a line for multiples, but twips for exact lengths. */
export function wordLineSpacing(value: unknown): { line?: number; lineRule?: 'auto' | 'exact' } {
  if (value == null || value === '' || value === 'normal') return {};
  const text = typeof value === 'string' ? value.trim() : '';
  const multiple = typeof value === 'number' ? value : /^\d*\.?\d+$/.test(text) ? Number(text) : null;
  const pixels = multiple === null ? absoluteLengthPixels(text) : null;
  const line = Math.round(multiple !== null ? multiple * 240 : pixels !== null ? pixels * 15 : NaN);
  if (!Number.isSafeInteger(line) || line <= 0 || line > 2147483647) {
    throw new Error('Word export cannot preserve this line spacing. Choose a line spacing from the toolbar, then export again.');
  }
  return { line, lineRule: multiple !== null ? 'auto' : 'exact' };
}

export function restoreWordLineSpacing(target: HTMLElement, line: string | undefined, rule: string | undefined, warnings: string[]) {
  if (line === undefined) return;
  const value = Number(line), kind = rule || 'auto';
  if (Number.isInteger(value) && value > 0 && value <= 2147483647 && (kind === 'auto' || kind === 'exact')) {
    target.style.lineHeight = kind === 'auto' ? String(value / 240) : `${Number((value / 15).toFixed(6))}px`;
    return;
  }
  const message = 'Some Word line spacing uses a minimum or unsupported setting that VDoc cannot preserve. Text is preserved; review line spacing after import.';
  if (!warnings.includes(message)) warnings.push(message);
}
