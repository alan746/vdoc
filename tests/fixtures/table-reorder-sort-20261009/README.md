# Table movement and sorting acceptance — 2026-10-09

Fixture `source.vdoc.json`, SHA-256 `f8ab05d6aa6fa2fc03edbf4515e0f0ac16f2491f327832a21b259bb1e3babf8a`.
Independent imported document `QA table reorder sort 2026-10-09`, ID `3ad7e097-15eb-4af2-8007-0c309f088746`.

Used public read_document/apply_document_operations with fresh session/revision and explicit cell targets; UI Undo/Redo/Print/import/navigation. Only this new sample edited.

| Case | Actual result |
| --- | --- |
| Move main row 1→3 tearing rowspan; move RTL column 0→1 tearing colspan; sort main merged body | All UNAVAILABLE, full document and revision exactly baseline |
| Main column 0→1, preserving vertical merges | Full JSON equals independent per-row cell-array reversal; merged cell moved to logical column 1; Undo exactly baseline |
| RTL row 2→1 containing nested content | Full JSON equals independent row-array move; nested table snapshot unchanged; Undo exactly baseline |
| Numeric ascending with 2 pinned header rows and merged header | Full JSON equals row permutation [0,1,3,5,4,2]; body 3,3,10,20; equal keys preserve Hindi first / Korean second order |
| Numeric descending | Full JSON equals [0,1,2,4,3,5]; Undo exactly ascending, next Undo exactly baseline |
| Language sv plus alphabetic sort in one batch | Full JSON equals independent language patch and [2,1,0] row permutation; order a,z,ä; single Undo exactly baseline, Redo exactly Swedish snapshot |
| Final numeric ascending plus Swedish order | Real preview 5 pages/A4 portrait, print enabled; return full JSON unchanged |
| Saved locally, exit, new tab/session | Full JSON exactly final snapshot, language sv, numeric 3,3,10,20 and alphabetic a,z,ä retained; Saved locally |

Archived under QA · Local workspace (98 top-level items). Final document keeps Swedish language, Swedish alphabetic ordering and numeric ascending; movement experiments were undone. Original fixture remains unsorted baseline.

Related tests: 4 files / 71 tests passed, `/tmp/vdoc-table-reorder-sort-targeted.log`. No product or test code changed; latest full/type/build baseline remains 132 files / 1879 tests. Rejected merged-body sorting is an explicit limitation, not support for sorting arbitrary merged tables. This verifies public operations and UI history/preview/storage, not mouse drag or every locale. Native IME/Safari printing/crash/quota/final signoff gates remain open.
