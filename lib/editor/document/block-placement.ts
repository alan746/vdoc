import type { Node } from '@tiptap/pm/model';
import type { Operation } from '../../domain/entities/operation';

/** Always use the live transaction document: earlier operations can have moved the anchor. */
export function findTopLevelBlock(doc: Node, id: string | null | undefined): { pos: number; node: Node; index: number } | undefined {
  if (id == null) return undefined;
  for (let index = 0, pos = 0; index < doc.childCount; pos += doc.child(index).nodeSize, index++) {
    if (doc.child(index).attrs.blockId === id) return { pos, node: doc.child(index), index };
  }
}

type Placement = Pick<Extract<Operation, { type: 'block.move' }>, 'beforeId' | 'position'>;

export function insertionPoint(doc: Node, placement: Placement): number | undefined {
  if (placement.position) {
    if (placement.beforeId !== undefined) return undefined;
    const anchor = findTopLevelBlock(doc, placement.position.anchorId);
    return anchor && anchor.pos + (placement.position.relation === 'after' ? anchor.node.nodeSize : 0);
  }
  return placement.beforeId === null ? doc.content.size : findTopLevelBlock(doc, placement.beforeId)?.pos;
}

/** Check the requested relationship before dispatch, so a failed placement rolls back the batch. */
export function isAtPlacement(doc: Node, id: string, placement: Placement): boolean {
  const moved = findTopLevelBlock(doc, id);
  if (!moved) return false;
  if (placement.position) {
    const anchor = findTopLevelBlock(doc, placement.position.anchorId);
    return !!anchor && moved.index === anchor.index + (placement.position.relation === 'after' ? 1 : -1);
  }
  if (placement.beforeId === null) return moved.index === doc.childCount - 1;
  const anchor = findTopLevelBlock(doc, placement.beforeId);
  return !!anchor && moved.index === anchor.index - 1;
}
