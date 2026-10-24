import type { Node } from '@tiptap/pm/model';

type Heading = { readonly id: string; readonly level: number; readonly text: string; readonly from: number };
type Note = { readonly number: number; readonly text: string };
type DisplaySummary = { readonly headings: readonly Heading[]; readonly notes: readonly Note[] };
const empty: DisplaySummary = { headings: [], notes: [] };
const cache = new WeakMap<Node, DisplaySummary>();

/** Display-only data shared by the outline and footnotes. ProseMirror reuses
 * unchanged subtrees, so a new document needs to combine their cached results,
 * not traverse their contents again. Positions are relative to each node;
 * combining children relocates headings after preceding edits or block moves.
 * Command targets and version checks still use the engine's live BlockIndex. */
export function documentDisplaySummary(node: Node): DisplaySummary {
  if (node.isText) return empty;
  const cached = cache.get(node);
  if (cached) return cached;
  const headings: Heading[] = [], notes: Note[] = [];
  if (node.type.name === 'heading' && typeof node.attrs.blockId === 'string')
    headings.push({ id: node.attrs.blockId, level: node.attrs.level, text: node.textContent, from: 0 });
  if (node.type.name === 'footnote') notes.push({ number: node.attrs.number, text: node.attrs.text });
  const root = node.type === node.type.schema.topNodeType;
  node.forEach((child, offset) => {
    const summary = documentDisplaySummary(child);
    // Match BlockIndex: an unidentified top-level container is not addressable.
    if (!root || typeof child.attrs.blockId === 'string') {
      for (const heading of summary.headings)
        headings.push({ ...heading, from: offset + (root ? 0 : 1) + heading.from });
    }
    for (const note of summary.notes) notes.push(note);
  });
  const summary = headings.length || notes.length ? { headings, notes } : empty;
  cache.set(node, summary);
  return summary;
}
