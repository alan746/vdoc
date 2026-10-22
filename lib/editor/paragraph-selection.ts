import type { Node as PMNode } from '@tiptap/pm/model';
import type { Selection } from '@tiptap/pm/state';

/** CellSelection has disjoint ranges. Never format cells between those ranges. */
export function selectedParagraphs(doc: PMNode, selection: Selection) {
  const nodes = new Map<number, PMNode>();
  for (const { $from, $to } of selection.ranges) {
    doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
      if (node.type.name === 'paragraph' || node.type.name === 'heading') nodes.set(pos, node);
    });
  }
  return [...nodes].sort(([a], [b]) => a - b).map(([pos, node]) => ({ pos, node }));
}

