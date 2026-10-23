/** cyrb53 (public domain): a fast, synchronous, non-cryptographic 53-bit string hash. */
function hash53(text: string): number {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** Equality key for idempotent retries: equal requests always give equal keys,
 *  and the key's size is constant whatever the payload (a 3 MB image is not
 *  retained twice). Only compared between requests that share an ID, so a false
 *  match needs a retry with changed arguments of the same serialised length and
 *  the same 53-bit hash. Synchronous because `DocumentEngine.execute` is. */
export function requestSignature(value: unknown): string {
  const json = JSON.stringify(value) ?? 'undefined';
  return `${json.length}:${hash53(json).toString(36)}`;
}
