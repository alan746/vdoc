import type { Node } from '@tiptap/pm/model';

export type IndexedBlock = { readonly node: Node; readonly pos: number; readonly version: number };
export type BlockRange = { from: number; to: number };

/**
 * One pass over the document per change, shared by every reader that needs a
 * block by ID: its session-local version (moving an unchanged block does not
 * invalidate it), its current position, and the headings in document order.
 *
 * Positions are only valid for the document passed to the last update(). Do
 * not use them inside a command batch: earlier operations in the same
 * transaction have already shifted the document the batch is editing.
 */
export class BlockIndex {
  private clock = 0;
  private entries = new Map<string, IndexedBlock>();
  private headingIds: string[] = [];
  private indexed: Node | null = null;

  update(doc: Node) {
    const next = new Map<string, IndexedBlock>(), headings: string[] = [];
    doc.descendants((node, pos) => {
      const id = node.attrs.blockId;
      if (typeof id !== 'string') return;
      const prior = this.entries.get(id);
      next.set(id, { node, pos, version: prior?.node.eq(node) ? prior.version : ++this.clock });
      if (node.type.name === 'heading') headings.push(id);
    });
    this.entries = next;
    this.headingIds = headings;
    this.indexed = doc;
  }

  /** True when the index describes exactly this document. */
  describes(doc: Node) { return this.indexed === doc; }
  get(id: string): IndexedBlock | undefined { return this.entries.get(id); }
  has(id: string) { return this.entries.has(id); }
  version(id: string): number | undefined { return this.entries.get(id)?.version; }
  range(id: string): BlockRange | undefined {
    const entry = this.entries.get(id);
    return entry && { from: entry.pos, to: entry.pos + entry.node.nodeSize };
  }
  headings(): IndexedBlock[] { return this.headingIds.map(id => this.entries.get(id)!); }
}
