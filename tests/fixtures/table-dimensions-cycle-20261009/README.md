# Imported dimensions and table properties acceptance — 2026-10-09

Fixture `source.vdoc.json`, SHA-256 `fcd1999a79a60c43e3809013c748a950ee182126a3c95429fe225c1005ccbfbb`.
Independent document `QA table dimensions cycle 2026-10-09`, ID `78b77677-c00b-4bf4-99ad-fedb6837e356`.

The added RTL table has a colspan header, 25/150px columns, a rowspan-2 body cell with legacy minimum height 130, and row minimum heights 60/70/60. Only this new document was edited.

## Observed defect and fix

Real Table properties Apply failed while changing alignment/padding/vertical alignment, because unchanged imported column width 25 violated HTML min=40. Read-only DOM validity reported `Value must be greater than or equal to 40.`; dialog remained and document was unchanged. Also found that property width editing submitted all columns, making an untouched narrow neighbour fail operation validation.

- Numeric form constraints now apply to changed values; unchanged imported values (including fractional padding/border/height) remain intact. Changed values retain the existing integer and range limits.
- Width edits generate operations only for selected columns, preserving imported widths outside the selection.
- 10 new component regressions; initial reproduction run 5 failed / 5 passed. Final tests independently cover narrow width and fractional imported dimensions, valid column editing next to a narrow column, illegal new dimensions, full JSON and Undo.

## Actual browser acceptance

- Public operation: column 1→190, full JSON equals independent patch; neighbour remains 25 and header widths [25,190].
- Row 1→95, full JSON equals independent patch; spanning cell keeps legacy 130, other row remains 60.
- Alignment plus distribution cutting a rowspan rejected atomically; full JSON/revision unchanged.
- Complete body rows distributed to 85, cell minimum heights cleared; full JSON exactly expected; UI Undo/Redo exact.
- Real properties UI: alignment center, selected header padding 12 and vertical middle. Before fix blocked; after fix exact full JSON, unchanged unequal widths retained, single Undo/Redo exact.
- Click Korean body cell, real properties UI column width 190→210. Exact full JSON, 25px neighbour retained, Undo/Redo exact.
- Real preview 5 pages/A4 portrait, print enabled; return full JSON unchanged.
- Separately confirmed Saved locally; exit/new session full JSON exactly final snapshot.
- New-session dialogs show body width 210 and row height 85; header width 25, padding 12, middle alignment, centered RTL table. Apply without changes closes normally with identical full JSON/revision.
- Saved locally confirmed separately; archived QA · Local workspace (99 top-level items). Final saved sample keeps edited dimensions/styles.

During one browser operation group automatic approval review timed out after distribution and Undo. Read-only inspection confirmed revision 4 and exact pre-distribution content; the tool-authorized retry completed Redo. No alternate automation surface or bypass was used.

Validation: related 4 files / 74 tests; full 133 files / 1889 tests (63.48s), typecheck then production build passed. Logs `/tmp/vdoc-table-dimensions-{before,targeted,full,types,build}.log`. Existing Vinext build notices remain. This does not validate native drag gestures or Safari PDF. Original seven native acceptance gates remain open.
