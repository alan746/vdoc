import type { Operation } from './operations';

export type ParagraphProperties = { spaceBefore: number; spaceAfter: number; indent: number };

/** Preserve mixed values and inherited defaults unless the user edits that field. */
export function paragraphPropertyOperation(before: ParagraphProperties, after: ParagraphProperties): Operation | null {
  const operation: Extract<Operation, {type: 'paragraph.style'}> = {type: 'paragraph.style'};
  for (const key of ['spaceBefore', 'spaceAfter', 'indent'] as const) {
    if (before[key] !== after[key]) operation[key] = after[key];
  }
  return Object.keys(operation).length > 1 ? operation : null;
}
