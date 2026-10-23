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

function indexBlocks(doc: Node): Map<string, BlockEntry> {
  const entries = new Map<string, BlockEntry>();
  const visit = (node: Node, tables: readonly string[], context: string) => {
    const id = node.attrs.blockId;
    if (typeof id === 'string') entries.set(id, { node, tables, context });
    const ancestors = node.type.name === 'table' && id ? [...tables, id] : tables;
    const parentContext = node.isTextblock || node.isAtom ? context : context + markup(node);
    node.forEach(child => { if (!child.isText) visit(child, ancestors, parentContext); });
  };
  // Document attributes are reported separately, not as changes to every block.
  doc.forEach(child => visit(child, [], ''));
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
  if (before.eq(after)) return [];
  const oldBlocks = indexBlocks(before), newBlocks = indexBlocks(after);
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
