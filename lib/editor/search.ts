import { normalizedSearchText, wordBoundaries } from './unicode';
import type { Node } from '@tiptap/pm/model';
export type Match = { from: number; to: number };
type SearchText = ReturnType<typeof normalizedSearchText> & { boundaries?: ReturnType<typeof wordBoundaries> };
const textCache = new WeakMap<Node, SearchText>();
function searchableText(node: Node): SearchText {
  let cached = textCache.get(node);
  if (!cached) {
    cached = normalizedSearchText(node.textBetween(0, node.content.size, '', '\ufffc'));
    textCache.set(node, cached);
  }
  return cached;
}
export function findMatches(doc: Node, query: string, caseSensitive = false, wholeWord = false): Match[] {
  if (!query) return [];
  const escaped = query.normalize('NFC').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(escaped, caseSensitive ? 'gu' : 'giu');
  const results: Match[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return;
    // ProseMirror nodes are immutable and unchanged paragraphs are shared
    // across edits. Cache local text offsets only, never document positions
    // or query results; moving a block must still use its current position.
    const normalized = searchableText(node), text = normalized.text;
    const boundaries = wholeWord ? (normalized.boundaries ??= wordBoundaries(text)) : null;
    for (const match of text.matchAll(pattern)) {
      const index = match.index!, end = index + match[0].length;
      if (normalized.offsets && (!normalized.offsets.has(index) || !normalized.offsets.has(end))) continue;
      if (boundaries && (!boundaries.starts.has(index) || !boundaries.ends.has(end))) continue;
      results.push({from:pos+1+(normalized.offsets?.get(index) ?? index),to:pos+1+(normalized.offsets?.get(end) ?? end)});
    }
    return false;
  });
  return results;
}
