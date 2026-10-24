# Native acceptance runbook

## Setup

Use a separate QA copy and a known revision. Record browser and operating-system versions, input method, date, origin, and build identity. Pair source backups with exported artifacts.

Reference samples:

- [Editing/search sample](../examples/final-native-acceptance.vdoc.json).
- [Safari printing sample](../tests/fixtures/safari-preview/source.vdoc.json).

Samples include A4 layout, a 36-body-row table, an image, a page break, and an end marker. Original multilingual markers remain in fixture data. Do not compare page counts from differently edited sources.

## Procedure

1. Import through **Your documents > Import**.
2. Exercise native composition in title, body, dialogs, and search. Observe candidates, cancellation, selection, and commit.
3. Search the fixed marker, confirm visibility, replace, and undo.
4. Export a backup and PDF in the same run. Record paper, margins, scale, browser headers, and counts.
5. Test 100% and the specified alternate print scale on the same source.
6. Inspect every page for clipping, images, missing/duplicate rows, header-only fragments, and final content.
7. In an isolated profile, verify persisted recovery after termination with before/after backups and save timing.
8. In isolated quota conditions, provoke write failure, inspect recovery, release space, and retry.
9. Run relevant automated checks for the same candidate.

## Evidence

Retain JSON/PDF pairs, hashes, settings, screenshots, observed results, and unresolved differences. A visible end marker means the page contains content.

Storage is scoped by origin. Another browser or hostname has a separate library. Browser automation availability alone does not establish native input, download, or print acceptance.

See [gates](ACCEPTANCE_GATE.md), [the final worksheet](acceptance/FINAL_FIVE_ACCEPTANCE.md), and [evidence](QA_EVIDENCE.md).
