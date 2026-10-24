# Implementation plan

## Scope and architecture

VDoc supports personal document creation, editing, storage, conversion, and voice-driven changes. Core editing remains usable locally. Cloud storage and authenticated voice sessions are optional service integrations.

Keep document rules and operation schemas in `lib/domain`, orchestration and ports in `lib/usecases`, editor behavior in `lib/editor`, and platform adapters in `lib/infrastructure`. Use `lib/composition` to connect implementations to the interface. New features use the shared operation, validation, and persistence paths.

## Work areas

| Area | Acceptance focus |
| --- | --- |
| Data safety | Autosave, failure recovery, document switching, trash, and version restoration |
| Editing | Selection, formatting, lists, tables, images, search, and undo |
| File delivery | Exact backups, DOCX round trips, downloads, and PDF output |
| Languages | Grapheme boundaries, composition, direction, and language metadata |
| Performance | Long-document input, selection, scrolling, and bounded processing |
| Voice editing | Lifecycle, explicit targets, cancellation, progress, and turn undo |
| Cloud documents | Authentication, ownership, isolated rooms, and server-side credentials |

## Completion criteria

Run relevant automated checks and record the source revision and environment for manual acceptance. Test the complete edit-save-export-reopen workflow with a fixed document. Use the same source backup for preview and PDF comparisons. Confirm output in an independent reader.

Do not infer platform acceptance from a DOM simulation, a conversion-only test, or an older artifact. Keep outstanding input-method, storage-failure, printing, and extraction cases visible in the [acceptance guide](ACCEPTANCE_GATE.md).

## Extension points

File formats use the shared registry and importer/exporter ports. Editor features use `EditorFeature`. Realtime transports implement `RealtimePort`. Storage adapters implement the document, library, and version repository contracts. Replacing an implementation should not require changing the domain protocol.

See [operations](OPERATIONS.md), [the realtime protocol](REALTIME_PROTOCOL.md), and [validation](VALIDATION.md).
