import type { Node } from '@tiptap/pm/model';

interface BlockEntry {
  node: Node;
  tables: readonly string[];
  context: string;
}

const markup = (node: Node) => {
  const { blockId: _, ...attrs } = node.attrs;
  return JSON.stringify([node.type.name, attrs, node.marks.map(mark => mark.toJSON())]);
};

/** Indexes the blocks under top-level children [from, to), except shared ones. */
function indexBlocks(doc: Node, from: number, to: number, skip: ReadonlySet<Node>): Map<string, BlockEntry> {
  const entries = new Map<string, BlockEntry>();
  const visit = (node: Node, tables: readonly string[], context: string) => {
    const id = node.attrs.blockId;
    if (typeof id === 'string') entries.set(id, { node, tables, context });
    const ancestors = node.type.name === 'table' && id ? [...tables, id] : tables;
    const parentContext = node.isTextblock || node.isAtom ? context : context + markup(node);
    node.forEach(child => { if (!child.isText) visit(child, ancestors, parentContext); });
  };
  // Document attributes are reported separately, not as changes to every block.
  for (let index = from; index < to; index++) { const child = doc.child(index); if (!skip.has(child)) visit(child, [], ''); }
  return entries;
}

function tableStructure(table: Node): string {
  const rows: unknown[] = [];
  table.forEach(row => {
    const cells: unknown[] = [];
    row.forEach(cell => cells.push([cell.type.name, cell.attrs.blockId, cell.attrs.rowspan, cell.attrs.colspan]));
    rows.push([row.attrs.blockId, cells]);
  });
  return JSON.stringify([markup(table), rows]);
}

function ownContent(node: Node): string {
  const children: unknown[] = [];
  node.forEach(child => children.push(child.isAtom && !child.isText && child.attrs.blockId
    ? { blockId: child.attrs.blockId, type: child.type.name }
    : child.toJSON()));
  return JSON.stringify([markup(node), children]);
}

/** Pure before/after projection, run after stable-ID normalization. No UI or engine dependency. */
export function changedBlockIds(before: Node, after: Node): string[] {
  if (before === after) return [];
  // ProseMirror reuses unchanged subtrees by reference. A top-level node that
  // is the same object in both documents holds the same blocks with the same
  // context ('' at top level) and the same table ancestry, so none of its
  // blocks can be reported: skip it on both sides. First trim the identical
  // prefix and suffix with pointer comparisons (no allocation; a typical edit
  // leaves a window of one or two children), then skip nodes that are shared
  // but moved inside the window. A node that moved between top level and a
  // nested position is top-level in only one document and is still compared.
  let start = 0, endBefore = before.childCount, endAfter = after.childCount;
  while (start < endBefore && start < endAfter && before.child(start) === after.child(start)) start++;
  while (endBefore > start && endAfter > start && before.child(endBefore - 1) === after.child(endAfter - 1)) { endBefore--; endAfter--; }
  const windowBefore = new Set<Node>(), shared = new Set<Node>();
  for (let index = start; index < endBefore; index++) windowBefore.add(before.child(index));
  for (let index = start; index < endAfter; index++) if (windowBefore.has(after.child(index))) shared.add(after.child(index));
  const oldBlocks = indexBlocks(before, start, endBefore, shared), newBlocks = indexBlocks(after, start, endAfter, shared);
  const ids = new Set([...oldBlocks.keys(), ...newBlocks.keys()]);
  const structuralTables = new Set<string>();
  for (const id of ids) {
    const old = oldBlocks.get(id)?.node, next = newBlocks.get(id)?.node;
    if (old?.type.name !== 'table' && next?.type.name !== 'table') continue;
    if (!old || !next || tableStructure(old) !== tableStructure(next)) structuralTables.add(id);
  }
  const changed: string[] = [];
  for (const id of ids) {
    const old = oldBlocks.get(id), next = newBlocks.get(id), entry = next ?? old!;
    if ([...(old?.tables ?? []), ...(next?.tables ?? [])].some(table => structuralTables.has(table))) continue;
    if (structuralTables.has(id)) { changed.push(id); continue; }
    if (!entry.node.isTextblock && !entry.node.isAtom) continue;
    if (!old || !next || old.context !== next.context ||
        (!old.node.eq(next.node) && ownContent(old.node) !== ownContent(next.node))) changed.push(id);
  }
  return changed;
}
