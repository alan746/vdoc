import type { Node } from '@tiptap/pm/model';
import { NodeSelection, TextSelection, type Selection } from '@tiptap/pm/state';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import type { Target } from '../../domain/entities/operation';
import { isTextBoundary } from '../../domain/text/unicode';

type Resolved = Selection | { error: string };
type Resolver<K extends Target['kind']> = (target: Extract<Target, { kind: K }>, doc: Node) => Resolved;

// One resolver per explicit target kind. A 'selection' target keeps the caller's selection.
const resolvers: { [K in Exclude<Target['kind'], 'selection'>]: Resolver<K> } = {
  range: (target, doc) => {
    const { from, to } = target;
    if (!doc.resolve(from).parent.inlineContent || !doc.resolve(to).parent.inlineContent) return { error: 'Text ranges must be inside editable content.' };
    if (!isTextBoundary(doc,from) || !isTextBoundary(doc,to)) return { error: 'Text ranges must not split a character or emoji.' };
    return TextSelection.create(doc, from, to);
  },
  cell: (target, doc) => {
    let cellPos: number | undefined;
    doc.descendants((node, pos) => {
      if (node.type.name !== 'table' || node.attrs.blockId !== target.tableId) return;
      node.forEach((row, rowOffset) => row.forEach((cell, cellOffset) => {
        if (cell.attrs.blockId === target.cellId) cellPos = pos + 2 + rowOffset + cellOffset;
      }));
      return false;
    });
    if (cellPos === undefined) return { error: 'The cell no longer exists in this table. Read the document again.' };
    return CellSelection.create(doc, cellPos);
  },
  cells: (target, doc) => {
    let found: { pos: number; node: Node } | undefined;
    doc.descendants((node, pos) => { if (node.type.name === 'table' && node.attrs.blockId === target.tableId) found = { pos, node }; });
    if (!found) return { error: 'The table no longer exists.' };
    const map = TableMap.get(found.node), endRow = target.endRow ?? target.row, endCol = target.endCol ?? target.col;
    if (target.row > endRow || target.col > endCol || endRow >= map.height || endCol >= map.width) return { error: 'Invalid table region.' };
    const start = found.pos + 1;
    return CellSelection.create(doc, start + map.map[target.row * map.width + target.col], start + map.map[endRow * map.width + endCol]);
  },
  block: (target, doc) => {
    const targetId = target.id;
    let found: { pos: number; size: number; textblock: boolean; atom: boolean } | undefined;
    doc.descendants((node, pos) => {
      if (node.attrs.blockId === targetId) found = { pos, size: node.nodeSize, textblock: node.isTextblock, atom: node.isAtom };
    });
    if (!found) return { error: 'The target no longer exists.' };
    if (found.atom) return NodeSelection.create(doc, found.pos);
    if (found.textblock) return TextSelection.create(doc, found.pos + 1, found.pos + found.size - 1);
    return TextSelection.between(doc.resolve(found.pos + 1), doc.resolve(found.pos + found.size - 1));
  },
};

/** Maps an operation target to an editor selection, or a TARGET error message. */
export function resolveTargetSelection(target: Target, doc: Node, current: Selection): Resolved {
  if (target.kind === 'selection') return current;
  return (resolvers[target.kind] as Resolver<typeof target.kind>)(target as never, doc);
}
