# Next native acceptance run

## Prepare and execute

Identify the revision, start a local production build, and use independent QA copies. Verify routes and record browser, platform, origin, input method, and print settings.

1. Import the fixed source and save a backup.
2. Exercise native composition, cancellation, and commit in all controls.
3. Verify search visibility, replacement, undo, and focus.
4. Export unchanged print samples at required scales with paired backups.
5. Inspect every page for clipping, rows, missing content, and blank tails.
6. Check multilingual extraction, selection, and search in independent readers.
7. Exercise real storage failure and recovery in isolation.
8. Run automated checks for the same candidate.
9. Record passed, failed, pending, and environment-blocked cases separately.

## PDF investigation

Reader versions can affect text order and word segmentation. Compare identical PDF bytes when isolating a reader defect. Whole-text extraction does not establish partial-selection or search correctness. Preserve original text; normalization is diagnostic only.

Experimental ordering, font-mapping, and annotation approaches must retain pixel output and source content before product integration. See [PDF experiments](../../tools/pdf-export/README.md).

Retain source/output pairs, hashes, settings, screenshots, and exact comparisons. Historical results apply to their original revision. See [the worksheet](FINAL_FIVE_ACCEPTANCE.md) and [native procedures](../NATIVE_ACCEPTANCE_RUNBOOK.md).
