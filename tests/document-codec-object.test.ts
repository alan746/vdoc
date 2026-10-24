import { describe, expect, it } from 'vitest';
import { normalizeDocument, parseDocument } from '../lib/infrastructure/persistence/document-codec';

const draft = () => ({ version: 1, id: 'object-document', title: '中文 العربية', savedAt: '2026-10-22T00:00:00.000Z', content: {
  type: 'doc', content: [
    { type: 'paragraph', attrs: { blockId: 'first', textAlign: undefined }, content: [{ type: 'text', text: 'café 👩‍💻', marks: [{ type: 'bold' }] }] },
    { type: 'image', attrs: { src: 'data:image/png;base64,AAAA', alt: 'Embedded image' } },
  ],
} });
function freeze(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  Object.values(value).forEach(freeze); Object.freeze(value);
}

it('normalizes ordinary document objects like the backup path without mutating inputs', () => {
  const input = draft(), before = structuredClone(input);
  freeze(input);
  const expected = parseDocument(JSON.stringify(input));
  const actual = normalizeDocument(input);
  expect(actual).toEqual(expected);
  expect(input).toEqual(before);
  expect(actual.content).not.toBe(input.content);
  expect(normalizeDocument(actual)).toEqual(actual);
});

describe('both entry points retain the same document validation', () => {
  it.each([
    null, [], 42,
    { ...draft(), version: 2 },
    { ...draft(), title: 'x'.repeat(501) },
    { ...draft(), content: { type: 'paragraph' } },
    { ...draft(), content: { type: 'doc', content: [null] } },
    { ...draft(), content: { type: 'doc', content: [{ type: 'unknown' }] } },
    { ...draft(), content: { type: 'doc', content: [{ type: 'image', attrs: { src: 'https://example.test/image.png' } }] } },
    { ...draft(), content: { type: 'doc', content: [{ type: 'text', text: 'Invalid root child' }] } },
  ])('rejects invalid input %# through both paths', input => {
    let message = '';
    try { parseDocument(JSON.stringify(input)); } catch (error) { message = (error as Error).message; }
    expect(message).not.toBe('');
    expect(() => normalizeDocument(input)).toThrow(message);
  });

  it('keeps BOM handling, malformed JSON errors and size limits on the string boundary', () => {
    const raw = JSON.stringify(draft());
    expect(parseDocument(`\uFEFF${raw}`)).toEqual(normalizeDocument(draft()));
    expect(() => parseDocument(raw, raw.length - 1)).toThrow('permitted length');
    expect(() => parseDocument('{')).toThrow('not valid JSON');
  });
});
