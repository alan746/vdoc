import { expect, it } from 'vitest';
import { requestSignature } from '../lib/shared/request-signature';

// vdoc#61: the idempotency key compared between retries that share an ID.

it('gives equal keys for equal values, including separately built ones', () => {
  const build = () => ({ id: 'a', operations: [{ type: 'text.insert', text: 'hello' }], expectedRevision: 3 });
  expect(requestSignature(build())).toBe(requestSignature(build()));
});

it('gives different keys across a corpus of near-identical requests', () => {
  const corpus = [
    ...Array.from({ length: 2000 }, (_, i) => ({ id: 'a', operations: [{ type: 'text.insert', text: `t${i}` }] })),
    ...Array.from({ length: 2000 }, (_, i) => ({ id: 'a', expectedRevision: i, operations: [{ type: 'text.clear' }] })),
    { id: 'a', operations: [{ type: 'text.insert', text: 'ab' }] }, { id: 'a', operations: [{ type: 'text.insert', text: 'ba' }] },
    { id: 'a', source: 'agent' }, { id: 'a', source: 'api' }, null, [], {}, '', 0,
  ];
  expect(new Set(corpus.map(requestSignature)).size).toBe(corpus.length);
});

it('keeps the key short and constant-sized for a 3 MB payload', () => {
  const src = `data:image/png;base64,${'A'.repeat(3 * 1024 * 1024)}`;
  const key = requestSignature({ id: 'img', operations: [{ type: 'image.insert', src }] });
  expect(key.length).toBeLessThan(40);
  expect(requestSignature({ id: 'img', operations: [{ type: 'image.insert', src: src.slice(0, -1) + 'B' }] })).not.toBe(key);
});

it('accepts values JSON cannot serialise to a string', () => {
  expect(requestSignature(undefined)).toBe(requestSignature(undefined));
});
