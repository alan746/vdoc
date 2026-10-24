import type { Node } from '@tiptap/pm/model';
import type { BlockLocation } from '../../domain/entities/block-location';

export type IndexedBlock = { readonly node: Node; readonly pos: number; readonly version: number; readonly location: BlockLocation };
export type BlockRange = { from: number; to: number };

/**
 * Describes the last document a reader indexed. One pass is shared by readers
 * that need a block by ID: its session-local version (moving an unchanged block does not
 * invalidate it), its current position, and the headings in document order.
 * Versions compare content with the previous update, not intervening transactions:
 * an edit and exact revert without an update in between retains the version.
 *
 * Positions are only valid for the document passed to the last update(). Do
 * not use them inside a command batch: earlier operations in the same
 * transaction have already shifted the document the batch is editing.
 */
export class BlockIndex {
  private clock = 0;
  private entries = new Map<string, IndexedBlock>();
  private headingIds: string[] = [];
  private topLevelIds: string[] = [];
  private indexed: Node | null = null;

  update(doc: Node) {
    const next = new Map<string, IndexedBlock>(), headings: string[] = [];
    const lineage = new Map<Node, { topLevelId: string; nearestId: string }>(), topLevelIds: string[] = [];
    let headingId: string | null = null;
    doc.descendants((node, pos, parent, siblingIndex) => {
      const id = node.attrs.blockId;
      const ancestor = parent ? lineage.get(parent) : undefined;
      const topLevelId = parent === doc ? id : ancestor?.topLevelId;
      // Some structural nodes (ordinary list items) have no ID of their own.
      // Keep the nearest identified container, never label their children as roots.
      const nearestId = typeof id === 'string' ? id : ancestor?.nearestId;
      if (node.childCount && typeof topLevelId === 'string' && nearestId) lineage.set(node, { topLevelId, nearestId });
      if (typeof id !== 'string' || typeof topLevelId !== 'string') return;
      if (parent === doc) {
        topLevelIds.push(id);
        if (node.type.name === 'heading') headingId = id;
      }
      const prior = this.entries.get(id);
      const siblingId = (index: number): string | null => index < 0 || !parent || index >= parent.childCount ? null : parent.child(index).attrs.blockId ?? null;
      next.set(id, { node, pos, version: prior?.node.eq(node) ? prior.version : ++this.clock,
        location: { parentId: parent === doc ? null : ancestor?.nearestId ?? null, topLevelId,
          previousSiblingId: siblingId(siblingIndex - 1), nextSiblingId: siblingId(siblingIndex + 1), headingId },
      });
      if (node.type.name === 'heading') headings.push(id);
    });
    this.entries = next;
    this.headingIds = headings;
    this.topLevelIds = topLevelIds;
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

  /** Bounded structural context without serializing the full document. O(log n + limit). */
  around(selection: BlockRange, limit = 32) {
    const at = (index: number) => this.entries.get(this.topLevelIds[index]);
    const floor = (pos: number) => {
      let low = 0, high = this.topLevelIds.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (at(middle)!.pos <= pos) low = middle + 1;
        else high = middle;
      }
      return Math.max(0, low - 1);
    };
    const first = floor(selection.from), last = floor(Math.max(selection.from, selection.to - 1));
    const selected = this.topLevelIds.slice(first, Math.min(last + 1, first + limit)).map(id => this.entries.get(id)!);
    const focus = at(first), heading = focus?.location.headingId;
    return { selected, truncated: last - first + 1 > limit, focus, previous: at(first - 1), next: at(last + 1), heading: heading ? this.entries.get(heading) : undefined };
  }
}
