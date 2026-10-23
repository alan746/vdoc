# Historical QA evidence

Issue #71 separates automated-test inputs from historical manual QA evidence.
The archive is a GitHub Release asset in this same private repository (not a
software release and not a claim of new acceptance). Git history is unchanged.
Existing clones retain old objects; shallow CI checkouts avoid the removed files.

Download [the archive and manifest](https://github.com/Q-cell2/vdoc/releases/tag/qa-evidence-20261017).
The source snapshot is [`dad3466`](https://github.com/Q-cell2/vdoc/tree/dad346695fc579009ba090cf961f5e69d4ecd032/tests/fixtures).
The archive preserves all 4022 file bytes across 104 directories, including the
original source manifests and negative/failure evidence. Four automated-input
directories remain under `tests/fixtures`; tests keep their existing paths.

Archive SHA-256: `8de2e42fde479ab8abdae200a68e2f009c2b143ebd5e6d6e6f178d0e2c2f4bd5`.
Compressed: 94,733,461 bytes. Unpacked: 206,133,784 bytes.
[Per-file manifest](QA_EVIDENCE_MANIFEST.json) maps every old path to its archive
member, byte length and SHA-256. A directory's historical audit/manifests explain
its scope; the links below identify supporting acceptance records where present.

## Restore only when running historical QA

From the checkout root, after downloading the release asset:

```sh
python3 tools/verify-qa-evidence.py --archive /path/to/vdoc-qa-evidence-20261017.tar.gz
tar -xzf /path/to/vdoc-qa-evidence-20261017.tar.gz
python3 tools/verify-qa-evidence.py --root qa-evidence
```

The root `qa-evidence/` is gitignored and excluded from TypeScript, lint, and the
source hygiene scan. Automated tests need no archive download. To use external
storage instead:

```sh
export VDOC_QA_EVIDENCE="/path/to/QA evidence"
mkdir -p "$VDOC_QA_EVIDENCE"
tar -xzf /path/to/vdoc-qa-evidence-20261017.tar.gz --strip-components=1 -C "$VDOC_QA_EVIDENCE"
python3 tools/verify-qa-evidence.py --root "$VDOC_QA_EVIDENCE"
```

JavaScript's `tools/qa-paths.cjs` (with an ESM facade) and Python's
`tools/qa_paths.py` read the same `tools/qa-paths.json`. Relative override paths are
resolved against the checkout, not the process working directory. `qaPath`/`qa_path`
route retained test inputs to their tracked directories and other evidence to the
configured root; `recorded_path` also resolves old strings in immutable reports.
`recorded_name` writes portable logical names even with an external evidence root.
Shell commands can use `node tools/qa-path.mjs <directory/file>`.

Historical plain-text paths and acceptance JSON retain their original evidence
paths and status; clickable Markdown links point to the pinned original commit.
Resolve plain-text paths with this index or the pinned source snapshot; do not
rewrite the source manifests to match today's code. Some historical PDF experiments
also require gitignored `output/pdf` files and local QA runtimes which were never
part of this tracked evidence tree; the archive does not invent or regenerate them.
No manual browser/native acceptance was rerun by this relocation.

Before archiving, all 87 issue/PR bodies, 9 issue comments and 0 PR review comments
available on 2026-10-17 were checked. #71 references this move; closed PR #11 mentions
`quota-retest-20261010`. Its bytes remain archived. The remaining directory mappings
are tied to #71 and the existing acceptance records below. Previously pasted commit
links continue to work through Git history.

## Directory index

All entries below restore under `qa-evidence/<directory>/` (or the configured root).

| Directory | Files | Bytes | Supporting records |
| --- | ---: | ---: | --- |
| `backup-id-isolation-20261008` | 2 | 5,126 | [VALIDATION.md](VALIDATION.md) |
| `browser-pdf-20261011` | 51 | 2,197,548 | [VALIDATION.md](VALIDATION.md), [acceptance/FINAL_FIVE_ACCEPTANCE.md](acceptance/FINAL_FIVE_ACCEPTANCE.md), [acceptance/NEXT_NATIVE_RUN.md](acceptance/NEXT_NATIVE_RUN.md), [acceptance/final-five-ledger.json](acceptance/final-five-ledger.json) |
| `browser-unicode-20261011` | 416 | 7,960,768 | [VALIDATION.md](VALIDATION.md), [acceptance/FINAL_FIVE_ACCEPTANCE.md](acceptance/FINAL_FIVE_ACCEPTANCE.md), [acceptance/NEXT_NATIVE_RUN.md](acceptance/NEXT_NATIVE_RUN.md), [acceptance/final-five-ledger.json](acceptance/final-five-ledger.json) |
| `core-delivery` | 3 | 17,040 | [VALIDATION.md](VALIDATION.md) |
| `core-final-candidate-20261012` | 21 | 2,745,695 | [VALIDATION.md](VALIDATION.md), [acceptance/AI_ENTRY_SEVEN_GATES.json](acceptance/AI_ENTRY_SEVEN_GATES.json), [acceptance/FINAL_FIVE_ACCEPTANCE.md](acceptance/FINAL_FIVE_ACCEPTANCE.md), [acceptance/NEXT_NATIVE_RUN.md](acceptance/NEXT_NATIVE_RUN.md) |
| `export-filename-20261009` | 4 | 22,953 | [VALIDATION.md](VALIDATION.md) |
| `external-composition-20261012` | 24 | 2,531,413 | [VALIDATION.md](VALIDATION.md), [acceptance/AI_ENTRY_SEVEN_GATES.json](acceptance/AI_ENTRY_SEVEN_GATES.json), [acceptance/FINAL_FIVE_ACCEPTANCE.md](acceptance/FINAL_FIVE_ACCEPTANCE.md), [acceptance/NEXT_NATIVE_RUN.md](acceptance/NEXT_NATIVE_RUN.md), [acceptance/final-five-ledger.json](acceptance/final-five-ledger.json) |
| `final-five-20261010` | 29 | 642,512 | [VALIDATION.md](VALIDATION.md), [acceptance/FINAL_FIVE_ACCEPTANCE.md](acceptance/FINAL_FIVE_ACCEPTANCE.md), [acceptance/final-five-ledger.json](acceptance/final-five-ledger.json) |
| `find-input-20261009` | 2 | 5,236 | [VALIDATION.md](VALIDATION.md) |
| `find-navigation-20261009` | 2 | 5,276 | [VALIDATION.md](VALIDATION.md) |
| `formatting-input-20261009` | 2 | 1,753 | [VALIDATION.md](VALIDATION.md) |
| `foundation-recheck-20261011` | 22 | 130,935 | [VALIDATION.md](VALIDATION.md), [acceptance/FINAL_FIVE_ACCEPTANCE.md](acceptance/FINAL_FIVE_ACCEPTANCE.md), [acceptance/NEXT_NATIVE_RUN.md](acceptance/NEXT_NATIVE_RUN.md), [acceptance/final-five-ledger.json](acceptance/final-five-ledger.json) |
| `foundation-release-check-20261011` | 39 | 1,463,554 | [VALIDATION.md](VALIDATION.md), [acceptance/FINAL_FIVE_ACCEPTANCE.md](acceptance/FINAL_FIVE_ACCEPTANCE.md), [acceptance/NEXT_NATIVE_RUN.md](acceptance/NEXT_NATIVE_RUN.md), [acceptance/final-five-ledger.json](acceptance/final-five-ledger.json) |
| `library-lifecycle-20261009` | 2 | 6,360 | [VALIDATION.md](VALIDATION.md) |
| `local-pdf-fontmap-20261012` | 17 | 913,552 | [VALIDATION.md](VALIDATION.md), [acceptance/AI_ENTRY_SEVEN_GATES.json](acceptance/AI_ENTRY_SEVEN_GATES.json), [acceptance/FINAL_FIVE_ACCEPTANCE.md](acceptance/FINAL_FIVE_ACCEPTANCE.md), [acceptance/NEXT_NATIVE_RUN.md](acceptance/NEXT_NATIVE_RUN.md) |
| `local-pdf-product-20261012` | 55 | 1,192,647 | [VALIDATION.md](VALIDATION.md), [acceptance/AI_ENTRY_SEVEN_GATES.json](acceptance/AI_ENTRY_SEVEN_GATES.json), [acceptance/FINAL_FIVE_ACCEPTANCE.md](acceptance/FINAL_FIVE_ACCEPTANCE.md), [acceptance/NEXT_NATIVE_RUN.md](acceptance/NEXT_NATIVE_RUN.md) |
| `local-pdf-production-20261012` | 90 | 3,310,612 | [VALIDATION.md](VALIDATION.md), [acceptance/AI_ENTRY_SEVEN_GATES.json](acceptance/AI_ENTRY_SEVEN_GATES.json), [acceptance/FINAL_FIVE_ACCEPTANCE.md](acceptance/FINAL_FIVE_ACCEPTANCE.md), [acceptance/NEXT_NATIVE_RUN.md](acceptance/NEXT_NATIVE_RUN.md) |
| `long-title-export-20261007` | 3 | 14,158 | [VALIDATION.md](VALIDATION.md) |
| `native-crash-20261010` | 8 | 653,063 | [ACCEPTANCE_GATE.md](ACCEPTANCE_GATE.md), [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md), [NATIVE_ACCEPTANCE_RUNBOOK.md](NATIVE_ACCEPTANCE_RUNBOOK.md), [VALIDATION.md](VALIDATION.md) |
| `native-ime-20261010` | 1 | 1,968 | [ACCEPTANCE_GATE.md](ACCEPTANCE_GATE.md), [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md), [VALIDATION.md](VALIDATION.md), [acceptance/FINAL_FIVE_ACCEPTANCE.md](acceptance/FINAL_FIVE_ACCEPTANCE.md), [acceptance/NEXT_NATIVE_RUN.md](acceptance/NEXT_NATIVE_RUN.md), [acceptance/final-five-ledger.json](acceptance/final-five-ledger.json) |
| `native-recheck-20261010` | 7 | 810,780 | [ACCEPTANCE_GATE.md](ACCEPTANCE_GATE.md), [VALIDATION.md](VALIDATION.md), [acceptance/FINAL_FIVE_ACCEPTANCE.md](acceptance/FINAL_FIVE_ACCEPTANCE.md), [acceptance/final-five-ledger.json](acceptance/final-five-ledger.json) |
| `operation-guards-20261009` | 2 | 167,635 | [VALIDATION.md](VALIDATION.md) |
| `overflow-guard-20261010` | 4 | 17,408 | [ACCEPTANCE_GATE.md](ACCEPTANCE_GATE.md), [VALIDATION.md](VALIDATION.md), [acceptance/FINAL_FIVE_ACCEPTANCE.md](acceptance/FINAL_FIVE_ACCEPTANCE.md), [acceptance/NEXT_NATIVE_RUN.md](acceptance/NEXT_NATIVE_RUN.md), [acceptance/final-five-ledger.json](acceptance/final-five-ledger.json) |
| `pdf-chrome155-20261012` | 70 | 2,364,955 | [VALIDATION.md](VALIDATION.md), [acceptance/AI_ENTRY_SEVEN_GATES.json](acceptance/AI_ENTRY_SEVEN_GATES.json), [acceptance/NEXT_NATIVE_RUN.md](acceptance/NEXT_NATIVE_RUN.md) |
| `pdf-cluster-current-20261012` | 18 | 225,819 | [#71](https://github.com/Q-cell2/vdoc/issues/71) |
| `pdf-cluster-visual-20261012` | 46 | 698,848 | [#71](https://github.com/Q-cell2/vdoc/issues/71) |
| `pdf-direct-readers-20261012` | 24 | 3,974,114 | [VALIDATION.md](VALIDATION.md), [acceptance/FINAL_FIVE_ACCEPTANCE.md](acceptance/FINAL_FIVE_ACCEPTANCE.md), [acceptance/NEXT_NATIVE_RUN.md](acceptance/NEXT_NATIVE_RUN.md), [acceptance/final-five-ledger.json](acceptance/final-five-ledger.json) |
| `pdf-direction-boundary-20261012` | 12 | 101,273 | [#71](https://github.com/Q-cell2/vdoc/issues/71) |
| `pdf-direction-final-20261012` | 71 | 1,771,275 | [#71](https://github.com/Q-cell2/vdoc/issues/71) |
| `pdf-direction-space-20261012` | 58 | 1,021,258 | [#71](https://github.com/Q-cell2/vdoc/issues/71) |
| `pdf-font-20261011` | 69 | 2,740,293 | [VALIDATION.md](VALIDATION.md), [acceptance/FINAL_FIVE_ACCEPTANCE.md](acceptance/FINAL_FIVE_ACCEPTANCE.md), [acceptance/NEXT_NATIVE_RUN.md](acceptance/NEXT_NATIVE_RUN.md), [acceptance/final-five-ledger.json](acceptance/final-five-ledger.json) |
| `pdf-libreoffice-20261012` | 49 | 884,285 | [VALIDATION.md](VALIDATION.md), [acceptance/AI_ENTRY_SEVEN_GATES.json](acceptance/AI_ENTRY_SEVEN_GATES.json), [acceptance/FINAL_FIVE_ACCEPTANCE.md](acceptance/FINAL_FIVE_ACCEPTANCE.md), [acceptance/NEXT_NATIVE_RUN.md](acceptance/NEXT_NATIVE_RUN.md) |
| `pdf-prefont-20261011` | 86 | 8,261,498 | [VALIDATION.md](VALIDATION.md), [acceptance/FINAL_FIVE_ACCEPTANCE.md](acceptance/FINAL_FIVE_ACCEPTANCE.md), [acceptance/NEXT_NATIVE_RUN.md](acceptance/NEXT_NATIVE_RUN.md), [acceptance/final-five-ledger.json](acceptance/final-five-ledger.json) |
| `pdf-reader-source-20261012` | 9 | 679,780 | [acceptance/AI_ENTRY_SEVEN_GATES.json](acceptance/AI_ENTRY_SEVEN_GATES.json) |
| `pdf-reader-upstream-20261012` | 40 | 2,052,710 | [VALIDATION.md](VALIDATION.md), [acceptance/AI_ENTRY_SEVEN_GATES.json](acceptance/AI_ENTRY_SEVEN_GATES.json), [acceptance/NEXT_NATIVE_RUN.md](acceptance/NEXT_NATIVE_RUN.md) |
| `pdf-reading-direction-20261012` | 17 | 207,051 | [VALIDATION.md](VALIDATION.md), [acceptance/AI_ENTRY_SEVEN_GATES.json](acceptance/AI_ENTRY_SEVEN_GATES.json), [acceptance/FINAL_FIVE_ACCEPTANCE.md](acceptance/FINAL_FIVE_ACCEPTANCE.md), [acceptance/NEXT_NATIVE_RUN.md](acceptance/NEXT_NATIVE_RUN.md) |
| `pdf-reportlab-20261012` | 42 | 649,252 | [VALIDATION.md](VALIDATION.md), [acceptance/AI_ENTRY_SEVEN_GATES.json](acceptance/AI_ENTRY_SEVEN_GATES.json), [acceptance/FINAL_FIVE_ACCEPTANCE.md](acceptance/FINAL_FIVE_ACCEPTANCE.md), [acceptance/NEXT_NATIVE_RUN.md](acceptance/NEXT_NATIVE_RUN.md) |
| `pdf-restart-recheck-20261012` | 15 | 846,025 | [VALIDATION.md](VALIDATION.md), [acceptance/AI_ENTRY_SEVEN_GATES.json](acceptance/AI_ENTRY_SEVEN_GATES.json), [acceptance/NEXT_NATIVE_RUN.md](acceptance/NEXT_NATIVE_RUN.md) |
| `pdf-reversed-chars-20261011` | 21 | 245,122 | [VALIDATION.md](VALIDATION.md), [acceptance/FINAL_FIVE_ACCEPTANCE.md](acceptance/FINAL_FIVE_ACCEPTANCE.md), [acceptance/NEXT_NATIVE_RUN.md](acceptance/NEXT_NATIVE_RUN.md), [acceptance/final-five-ledger.json](acceptance/final-five-ledger.json) |
| `pdf-rtl-matrix-20261012` | 19 | 167,681 | [VALIDATION.md](VALIDATION.md), [acceptance/FINAL_FIVE_ACCEPTANCE.md](acceptance/FINAL_FIVE_ACCEPTANCE.md), [acceptance/NEXT_NATIVE_RUN.md](acceptance/NEXT_NATIVE_RUN.md), [acceptance/final-five-ledger.json](acceptance/final-five-ledger.json) |
| `pdf-story-20261012` | 27 | 232,319 | [VALIDATION.md](VALIDATION.md), [acceptance/FINAL_FIVE_ACCEPTANCE.md](acceptance/FINAL_FIVE_ACCEPTANCE.md), [acceptance/NEXT_NATIVE_RUN.md](acceptance/NEXT_NATIVE_RUN.md), [acceptance/final-five-ledger.json](acceptance/final-five-ledger.json) |
| `pdf-text-segments-20261012` | 15 | 187,153 | [VALIDATION.md](VALIDATION.md), [acceptance/AI_ENTRY_SEVEN_GATES.json](acceptance/AI_ENTRY_SEVEN_GATES.json), [acceptance/FINAL_FIVE_ACCEPTANCE.md](acceptance/FINAL_FIVE_ACCEPTANCE.md), [acceptance/NEXT_NATIVE_RUN.md](acceptance/NEXT_NATIVE_RUN.md) |
| `pdf-token-boundary-20261011` | 39 | 513,393 | [VALIDATION.md](VALIDATION.md), [acceptance/FINAL_FIVE_ACCEPTANCE.md](acceptance/FINAL_FIVE_ACCEPTANCE.md), [acceptance/NEXT_NATIVE_RUN.md](acceptance/NEXT_NATIVE_RUN.md), [acceptance/final-five-ledger.json](acceptance/final-five-ledger.json) |
| `pdf-type0-minimal-20261011` | 43 | 485,135 | [VALIDATION.md](VALIDATION.md), [acceptance/FINAL_FIVE_ACCEPTANCE.md](acceptance/FINAL_FIVE_ACCEPTANCE.md), [acceptance/NEXT_NATIVE_RUN.md](acceptance/NEXT_NATIVE_RUN.md), [acceptance/final-five-ledger.json](acceptance/final-five-ledger.json) |
| `pdf-unicode-20261011` | 129 | 5,515,699 | [VALIDATION.md](VALIDATION.md), [acceptance/FINAL_FIVE_ACCEPTANCE.md](acceptance/FINAL_FIVE_ACCEPTANCE.md), [acceptance/NEXT_NATIVE_RUN.md](acceptance/NEXT_NATIVE_RUN.md), [acceptance/final-five-ledger.json](acceptance/final-five-ledger.json) |
| `pdfkit-browser-20261011` | 75 | 1,579,926 | [VALIDATION.md](VALIDATION.md), [acceptance/FINAL_FIVE_ACCEPTANCE.md](acceptance/FINAL_FIVE_ACCEPTANCE.md), [acceptance/NEXT_NATIVE_RUN.md](acceptance/NEXT_NATIVE_RUN.md), [acceptance/final-five-ledger.json](acceptance/final-five-ledger.json) |
| `picker-input-20261009` | 2 | 1,735 | [VALIDATION.md](VALIDATION.md) |
| `preview-container-width-20261010` | 11 | 375,268 | [acceptance/NEXT_NATIVE_RUN.md](acceptance/NEXT_NATIVE_RUN.md) |
| `preview-failure-cleanup-20261011` | 18 | 178,309 | [VALIDATION.md](VALIDATION.md), [acceptance/FINAL_FIVE_ACCEPTANCE.md](acceptance/FINAL_FIVE_ACCEPTANCE.md), [acceptance/NEXT_NATIVE_RUN.md](acceptance/NEXT_NATIVE_RUN.md), [acceptance/final-five-ledger.json](acceptance/final-five-ledger.json) |
| `preview-handshake-20261010` | 1 | 1,135 | [VALIDATION.md](VALIDATION.md) |
| `preview-hard-breaks-20261009` | 2 | 35,501 | [VALIDATION.md](VALIDATION.md) |
| `preview-header-structure-20261009` | 2 | 39,764 | [VALIDATION.md](VALIDATION.md) |
| `preview-image-visibility-20261011` | 17 | 108,544 | [VALIDATION.md](VALIDATION.md), [acceptance/FINAL_FIVE_ACCEPTANCE.md](acceptance/FINAL_FIVE_ACCEPTANCE.md), [acceptance/NEXT_NATIVE_RUN.md](acceptance/NEXT_NATIVE_RUN.md), [acceptance/final-five-ledger.json](acceptance/final-five-ledger.json) |
| `preview-merged-grid-20261009` | 2 | 164,027 | [VALIDATION.md](VALIDATION.md) |
| `preview-native-recheck-20261011` | 6 | 45,367 | [VALIDATION.md](VALIDATION.md), [acceptance/FINAL_FIVE_ACCEPTANCE.md](acceptance/FINAL_FIVE_ACCEPTANCE.md), [acceptance/NEXT_NATIVE_RUN.md](acceptance/NEXT_NATIVE_RUN.md), [acceptance/final-five-ledger.json](acceptance/final-five-ledger.json) |
| `preview-object-order-20261009` | 2 | 37,461 | [VALIDATION.md](VALIDATION.md) |
| `preview-paper-matrix-20261009` | 2 | 167,210 | [VALIDATION.md](VALIDATION.md) |
| `preview-physical-columns-20261009` | 2 | 166,481 | [VALIDATION.md](VALIDATION.md) |
| `production-smoke-20261010` | 2 | 162,773 | [ACCEPTANCE_GATE.md](ACCEPTANCE_GATE.md), [VALIDATION.md](VALIDATION.md), [acceptance/FINAL_FIVE_ACCEPTANCE.md](acceptance/FINAL_FIVE_ACCEPTANCE.md), [acceptance/final-five-ledger.json](acceptance/final-five-ledger.json) |
| `quota-bucket-20261010` | 18 | 296,908 | [ACCEPTANCE_GATE.md](ACCEPTANCE_GATE.md), [VALIDATION.md](VALIDATION.md), [acceptance/FINAL_FIVE_ACCEPTANCE.md](acceptance/FINAL_FIVE_ACCEPTANCE.md), [acceptance/NEXT_NATIVE_RUN.md](acceptance/NEXT_NATIVE_RUN.md), [acceptance/final-five-ledger.json](acceptance/final-five-ledger.json) |
| `quota-retest-20261010` | 111 | 4,264,336 | [ACCEPTANCE_GATE.md](ACCEPTANCE_GATE.md), [VALIDATION.md](VALIDATION.md), [acceptance/FINAL_FIVE_ACCEPTANCE.md](acceptance/FINAL_FIVE_ACCEPTANCE.md), [acceptance/NEXT_NATIVE_RUN.md](acceptance/NEXT_NATIVE_RUN.md), [acceptance/final-five-ledger.json](acceptance/final-five-ledger.json); [PR #11](https://github.com/Q-cell2/vdoc/pull/11) |
| `rapid-native-selection-20261010` | 26 | 746,953 | [ACCEPTANCE_GATE.md](ACCEPTANCE_GATE.md), [VALIDATION.md](VALIDATION.md), [acceptance/FINAL_FIVE_ACCEPTANCE.md](acceptance/FINAL_FIVE_ACCEPTANCE.md), [acceptance/NEXT_NATIVE_RUN.md](acceptance/NEXT_NATIVE_RUN.md), [acceptance/final-five-ledger.json](acceptance/final-five-ledger.json) |
| `reader-control-20261011` | 1026 | 37,024,876 | [VALIDATION.md](VALIDATION.md), [acceptance/FINAL_FIVE_ACCEPTANCE.md](acceptance/FINAL_FIVE_ACCEPTANCE.md), [acceptance/NEXT_NATIVE_RUN.md](acceptance/NEXT_NATIVE_RUN.md), [acceptance/final-five-ledger.json](acceptance/final-five-ledger.json) |
| `safari-external-composition-20261012` | 8 | 236,824 | [#71](https://github.com/Q-cell2/vdoc/issues/71) |
| `safari-fixed-pdf-20261011` | 119 | 5,219,041 | [VALIDATION.md](VALIDATION.md), [acceptance/FINAL_FIVE_ACCEPTANCE.md](acceptance/FINAL_FIVE_ACCEPTANCE.md), [acceptance/NEXT_NATIVE_RUN.md](acceptance/NEXT_NATIVE_RUN.md), [acceptance/final-five-ledger.json](acceptance/final-five-ledger.json) |
| `safari-focused-ax-20261011` | 5 | 39,116 | [ACCEPTANCE_GATE.md](ACCEPTANCE_GATE.md), [VALIDATION.md](VALIDATION.md), [acceptance/NEXT_NATIVE_RUN.md](acceptance/NEXT_NATIVE_RUN.md), [acceptance/final-five-ledger.json](acceptance/final-five-ledger.json) |
| `safari-focused-ax-recovery-20261011` | 3 | 5,886 | [#71](https://github.com/Q-cell2/vdoc/issues/71) |
| `safari-image-background` | 19 | 1,217,633 | [#71](https://github.com/Q-cell2/vdoc/issues/71) |
| `safari-native-fields-20261011` | 83 | 28,318,198 | [ACCEPTANCE_GATE.md](ACCEPTANCE_GATE.md), [VALIDATION.md](VALIDATION.md), [acceptance/FINAL_FIVE_ACCEPTANCE.md](acceptance/FINAL_FIVE_ACCEPTANCE.md), [acceptance/NEXT_NATIVE_RUN.md](acceptance/NEXT_NATIVE_RUN.md), [acceptance/final-five-ledger.json](acceptance/final-five-ledger.json) |
| `safari-native-ime-20261010` | 97 | 27,730,038 | [ACCEPTANCE_GATE.md](ACCEPTANCE_GATE.md), [VALIDATION.md](VALIDATION.md), [acceptance/FINAL_FIVE_ACCEPTANCE.md](acceptance/FINAL_FIVE_ACCEPTANCE.md), [acceptance/NEXT_NATIVE_RUN.md](acceptance/NEXT_NATIVE_RUN.md), [acceptance/final-five-ledger.json](acceptance/final-five-ledger.json) |
| `safari-native-operation-20261012` | 20 | 693,993 | [#71](https://github.com/Q-cell2/vdoc/issues/71) |
| `safari-native-print-20261011` | 21 | 1,344,365 | [ACCEPTANCE_GATE.md](ACCEPTANCE_GATE.md), [VALIDATION.md](VALIDATION.md), [acceptance/FINAL_FIVE_ACCEPTANCE.md](acceptance/FINAL_FIVE_ACCEPTANCE.md), [acceptance/NEXT_NATIVE_RUN.md](acceptance/NEXT_NATIVE_RUN.md), [acceptance/final-five-ledger.json](acceptance/final-five-ledger.json) |
| `safari-pdf-native-20261011` | 234 | 9,689,799 | [VALIDATION.md](VALIDATION.md), [acceptance/FINAL_FIVE_ACCEPTANCE.md](acceptance/FINAL_FIVE_ACCEPTANCE.md), [acceptance/NEXT_NATIVE_RUN.md](acceptance/NEXT_NATIVE_RUN.md), [acceptance/final-five-ledger.json](acceptance/final-five-ledger.json) |
| `safari-pinned-paint-20261010` | 30 | 4,769,333 | [ACCEPTANCE_GATE.md](ACCEPTANCE_GATE.md), [VALIDATION.md](VALIDATION.md), [acceptance/NEXT_NATIVE_RUN.md](acceptance/NEXT_NATIVE_RUN.md), [acceptance/final-five-ledger.json](acceptance/final-five-ledger.json) |
| `safari-preview-frame-diagnostic.html` | 1 | 2,307 | [VALIDATION.md](VALIDATION.md) |
| `safari-print-capture-20261011` | 27 | 1,673,156 | [ACCEPTANCE_GATE.md](ACCEPTANCE_GATE.md), [VALIDATION.md](VALIDATION.md), [acceptance/FINAL_FIVE_ACCEPTANCE.md](acceptance/FINAL_FIVE_ACCEPTANCE.md), [acceptance/NEXT_NATIVE_RUN.md](acceptance/NEXT_NATIVE_RUN.md), [acceptance/final-five-ledger.json](acceptance/final-five-ledger.json) |
| `safari-print-scale` | 11 | 30,546 | [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md), [NATIVE_ACCEPTANCE_RUNBOOK.md](NATIVE_ACCEPTANCE_RUNBOOK.md), [VALIDATION.md](VALIDATION.md) |
| `safari-search-20261010` | 2 | 161,741 | [ACCEPTANCE_GATE.md](ACCEPTANCE_GATE.md), [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md), [NATIVE_ACCEPTANCE_RUNBOOK.md](NATIVE_ACCEPTANCE_RUNBOOK.md), [VALIDATION.md](VALIDATION.md) |
| `safari-upload-diagnostic.html` | 1 | 991 | [#71](https://github.com/Q-cell2/vdoc/issues/71) |
| `safari-webdriver` | 98 | 16,329,524 | [ACCEPTANCE_GATE.md](ACCEPTANCE_GATE.md), [VALIDATION.md](VALIDATION.md), [acceptance/FINAL_FIVE_ACCEPTANCE.md](acceptance/FINAL_FIVE_ACCEPTANCE.md), [acceptance/NEXT_NATIVE_RUN.md](acceptance/NEXT_NATIVE_RUN.md), [acceptance/final-five-ledger.json](acceptance/final-five-ledger.json) |
| `search-cache-20261009` | 2 | 529,578 | [VALIDATION.md](VALIDATION.md) |
| `search-zoom-20261010` | 7 | 78,774 | [ACCEPTANCE_GATE.md](ACCEPTANCE_GATE.md), [VALIDATION.md](VALIDATION.md), [acceptance/FINAL_FIVE_ACCEPTANCE.md](acceptance/FINAL_FIVE_ACCEPTANCE.md), [acceptance/NEXT_NATIVE_RUN.md](acceptance/NEXT_NATIVE_RUN.md), [acceptance/final-five-ledger.json](acceptance/final-five-ledger.json) |
| `seven-gates-20261012` | 46 | 2,111,365 | [VALIDATION.md](VALIDATION.md), [acceptance/AI_ENTRY_SEVEN_GATES.json](acceptance/AI_ENTRY_SEVEN_GATES.json), [acceptance/FINAL_FIVE_ACCEPTANCE.md](acceptance/FINAL_FIVE_ACCEPTANCE.md), [acceptance/NEXT_NATIVE_RUN.md](acceptance/NEXT_NATIVE_RUN.md) |
| `seven-gates-impasse-20261012` | 3 | 10,606 | [acceptance/AI_ENTRY_SEVEN_GATES.json](acceptance/AI_ENTRY_SEVEN_GATES.json) |
| `table-dimensions-cycle-20261009` | 2 | 171,701 | [VALIDATION.md](VALIDATION.md) |
| `table-editing-cycle-20261009` | 2 | 167,228 | [VALIDATION.md](VALIDATION.md) |
| `table-reorder-sort-20261009` | 2 | 176,071 | [VALIDATION.md](VALIDATION.md) |
| `target-lifecycle-20261009` | 3 | 333,441 | [VALIDATION.md](VALIDATION.md) |
| `title-boundary-20261007` | 4 | 12,209 | [VALIDATION.md](VALIDATION.md) |
| `trash-save-guard-20261010` | 9 | 204,250 | [ACCEPTANCE_GATE.md](ACCEPTANCE_GATE.md), [VALIDATION.md](VALIDATION.md), [acceptance/FINAL_FIVE_ACCEPTANCE.md](acceptance/FINAL_FIVE_ACCEPTANCE.md), [acceptance/final-five-ledger.json](acceptance/final-five-ledger.json) |
| `typst-browser-20261011` | 22 | 303,793 | [#71](https://github.com/Q-cell2/vdoc/issues/71) |
| `version-input-20261009` | 2 | 5,494 | [VALIDATION.md](VALIDATION.md) |
| `webkit-print-viewport-20261011` | 56 | 296,738 | [VALIDATION.md](VALIDATION.md), [acceptance/FINAL_FIVE_ACCEPTANCE.md](acceptance/FINAL_FIVE_ACCEPTANCE.md), [acceptance/NEXT_NATIVE_RUN.md](acceptance/NEXT_NATIVE_RUN.md), [acceptance/final-five-ledger.json](acceptance/final-five-ledger.json) |
| `word-code-blocks-20261009` | 3 | 14,981 | [VALIDATION.md](VALIDATION.md) |
| `word-dividers-20261009` | 3 | 15,449 | [VALIDATION.md](VALIDATION.md) |
| `word-empty-list-20261009` | 3 | 18,757 | [VALIDATION.md](VALIDATION.md) |
| `word-footnotes-20261009` | 3 | 14,267 | [VALIDATION.md](VALIDATION.md) |
| `word-inline-code-20261009` | 3 | 14,743 | [VALIDATION.md](VALIDATION.md) |
| `word-list-flow-20261009` | 3 | 17,752 | [VALIDATION.md](VALIDATION.md) |
| `word-list-images-20261009` | 3 | 20,476 | [VALIDATION.md](VALIDATION.md) |
| `word-list-tables-20261009` | 3 | 26,055 | [VALIDATION.md](VALIDATION.md) |
| `word-numbering-20261009` | 3 | 47,174 | [VALIDATION.md](VALIDATION.md) |
| `word-outline-20261009` | 3 | 22,568 | [VALIDATION.md](VALIDATION.md) |
| `word-quotes-20261009` | 3 | 18,319 | [VALIDATION.md](VALIDATION.md) |
