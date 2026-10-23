import type { Node } from '@tiptap/pm/model';

/** Session-local versions. Moving an unchanged block does not invalidate it. */
export class BlockVersions {
  private clock = 0;
  private entries = new Map<string, { node: Node; version: number }>();

  update(doc: Node) {
    const next = new Map<string, { node: Node; version: number }>();
    doc.descendants(node => {
      const id = node.attrs.blockId;
      if (typeof id !== 'string') return;
      const prior = this.entries.get(id);
      next.set(id, prior?.node.eq(node) ? prior : { node, version: ++this.clock });
    });
    this.entries = next;
  }

  get(id: string): number | undefined { return this.entries.get(id)?.version; }
}
