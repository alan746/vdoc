# Document operation interface

The editor exposes `window.vdoc` for explicit local document operations. The domain schemas in `lib/domain/entities/operation.ts` are authoritative for parameters and limits.

## Snapshots and targets

`window.vdoc.snapshot()` returns the schema version, session ID, revision, selection, blocks, tables, and structured document. Blocks have stable IDs, versions, types, text, and positions. Table snapshots include logical dimensions, direction, pinning, row properties, and unique cells with stable IDs and spans.

External requests require `expectedSessionId` and explicit targets. Use `expectedRevision` for absolute positions, document-wide changes, or structural edits. Eligible block/text/cell edits can use covering `expectedBlocks: [{ id, version }]`. When both forms are provided, all conditions must match.

Block versions describe observed content and properties, not every intermediate edit event. Use the global revision to detect any document change. Sessions change when documents are reopened, switched, or refreshed.

| Target | Meaning |
| --- | --- |
| `range` | ProseMirror `from`/`to` positions with a current global revision |
| `block` | Stable block `id` |
| `text` | `blockId` and block-local UTF-16 `start`/`end` offsets |
| `cell` | Stable `tableId` and `cellId` |
| `cells` | Logical `row`, `col`, `endRow`, and `endCol` within a table |

Text boundaries cannot split graphemes. Inline atoms are not plain-text offsets. Cell coordinates are zero-based and rectangular end coordinates are inclusive. Missing or deleted identities must not silently retarget an unrelated object.

```js
const state = window.vdoc.snapshot();
window.vdoc.execute({
  expectedSessionId: state.sessionId,
  expectedRevision: state.revision,
  id: 'format-001',
  source: 'api',
  label: 'Emphasize selected text',
  target: { kind: 'range', from: state.selection.from, to: state.selection.to },
  operations: [
    { type: 'text.style', style: { underline: true } },
    { type: 'text.style', style: { highlight: '#FFF0AD' } }
  ]
});
```

## Operation families

| Family | Operations and behavior |
| --- | --- |
| Text formatting | `text.style`, `text.toggle`, and `text.clear`; omitted styles remain unchanged |
| Matching text | `text.styleMatches` styles all matching occurrences in the requested scope |
| Text content | `text.insert`, `text.delete`, `text.replace`, and `text.findReplace` |
| Paragraphs | `paragraph.style`, `paragraph.indent`, and `paragraph.adjustIndent` |
| Lists | `list.toggle`, `list.indent`, `list.style`, `list.marker`, `list.restart`, `list.continue`, and `list.checklistStyle` |
| Blocks | `block.insert`, `block.move`, `block.delete`, `block.quote`, `block.rule`, `block.code`, `block.toc`, and `block.pageBreak` |
| Table structure | `table.insert`, `table.edit`, and `table.split` |
| Table presentation | `table.style`, `table.border`, `table.background`, `table.layout`, and `table.direction` |
| Table dimensions | `table.widths`, `table.columnWidth`, `table.rowHeight`, and `table.distributeRows` |
| Table behavior | `table.sort`, `table.move`, `table.pinRows`, and `table.rowBreak` |
| Document | `document.layout` and `document.language` |
| Images | `image.insert` and `image.update` |
| Footnotes | `footnote.insert` and `footnote.update` |
| Links | `link.set` and `link.unset` |

Text insertion accepts plain text; line breaks become hard breaks rather than HTML. Search uses literal matching with normalization-equivalent boundaries and optional case/whole-word controls. Text styling supports common marks, supported font families, 8-96 px sizes, scripts, and six-digit colors.

Block placement uses `position: { anchorId, relation: 'before' | 'after' }` or the compatible `beforeId` field, never both. Interpret boundaries according to the operation schema. Read stable IDs before applying structural edits.

Table insertion supports up to 30 rows and 20 columns. Ordinary-cell subdivision is distinct from unmerging. Widths are 40-1200 px, row heights are minimums, and invalid span transformations reject the batch. Pinning is independent of header-cell styling. Sorting protects the pinned prefix and rejects unsupported merged data regions.

Table indices remain logical under RTL; column zero appears on the right. Border `left`/`right` denote physical edges. Per-row split preferences use an inclusive `from` and exclusive `to`. They express layout intent rather than a guaranteed final page break.

Paragraph settings include direction, heading level, alignment, spacing, indentation, tab interval, background, borders, and page-flow controls through their defined operations. Document layout supports A4/Letter, orientation, margins, color, headers, footers, and numbers. Language uses a validated BCP 47 tag.

## Atomicity, results, and retries

A request contains at most 100 operations. The target resolves once, and later operations use the evolving transaction. A failed step prevents the whole batch from committing. Stored-mark-only changes need not increase the document revision.

Successful results include `ok`, `id`, and `revision`. Failures also include a stable `code` and application error message.

| Code | Meaning |
| --- | --- |
| `INVALID` | Invalid request or parameters |
| `STALE` | Session, revision, or block precondition no longer matches |
| `TARGET` | Missing, invalid, or unsupported target |
| `UNAVAILABLE` | Operation or history is unavailable in the current context |
| `COMPOSING` | Composition is active |
| `DUPLICATE` | A successful call ID was reused with a different request |

Identical successful call retries return the original result within the engine session. Changed payloads with a retained ID are rejected. Refreshing creates a new session. After `STALE`, reread and reassess the target before retrying; do not merely replace the revision on an old intent.

## Undo and change events

`window.vdoc.undo()` and `redo()` use ordinary editing history. Turn-specific undo applies inverse steps with position mapping, preserving later user input where safe. It validates the entire inverse before committing and rejects unsafe structural conflicts atomically. Unavailable or partially evicted turns cannot be partly undone. Composition and closed sessions reject execution.

`engine.onApplied(listener)` returns an unsubscribe function. Successful changes report identity, source, revision, changed block IDs, and whether document content changed. Failures, no-ops, stale requests, and idempotent retries do not emit duplicate change events.

## Shared tools and structured articles

`documentToolCatalog` in `lib/usecases/document-tools.ts` provides shared descriptions and schemas for `read_document`, `read_blocks`, `get_context`, `apply_document_operations`, `insert_structured_article`, and `undo_turn`. Browser-exposed and turn-aware tools use their appropriate execution paths; sharing a catalog does not make their authorization contexts interchangeable.

Structured article insertion validates its complete payload, destination, and preconditions before committing. Streaming is a preview; final content enters through the complete validated call. Retain article data across stale failures, reread the destination, and retry with fresh preconditions. Final insertion preserves user selection and typing marks.

See [the realtime protocol](REALTIME_PROTOCOL.md), [text acceptance](TEXT_ACCEPTANCE.md), and [table acceptance](TABLE_ACCEPTANCE.md).
