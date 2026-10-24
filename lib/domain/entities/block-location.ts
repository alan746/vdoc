/** Structural coordinates, independent of viewport pixels and editor implementation. */
export interface BlockLocation {
  /** Nearest containing block with a stable ID; null only at document level. */
  readonly parentId: string | null;
  readonly topLevelId: string;
  readonly previousSiblingId: string | null;
  readonly nextSiblingId: string | null;
  readonly headingId: string | null;
}

/** Final position after the entire batch; null means a later operation removed the block. */
export interface BlockMoveResult {
  readonly id: string;
  readonly location: BlockLocation | null;
}
