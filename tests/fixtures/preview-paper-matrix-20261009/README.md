# Paper settings matrix — 2026-10-09

Fixture `source.vdoc.json`, SHA-256 `f0cc31f063b9cb3b71ee90496ace76704b6ac7a99e583eebf91b4c5e59efb776`.

Independent import: `QA preview paper matrix 2026-10-09`, ID `3a09707d-c9a4-403d-83ca-6b109b1c7930`. Complex three-table fixture with rowspans/colspans, repeated headers, image, RTL secondary table and nested table.

All settings were changed through Format → Page setup, then Print. Public document reads verified body JSON unchanged and requested attributes applied. Preview return preserved the entire snapshot.

| Paper | Orientation | Margin | Actual preview |
| --- | --- | --- | --- |
| A4 | Portrait | 20mm | 5 pages, print enabled |
| A4 | Landscape | 15mm | 6 pages, print enabled |
| Letter | Portrait | 20mm | 5 pages, print enabled |
| Letter | Landscape | 25mm | 8 pages, print enabled; page 8 selected |

Undo from Letter landscape restored the exact Letter portrait JSON; Redo restored exact landscape JSON. After separately checking Saved locally, exited and opened a fresh tab/session. Full document matched the Letter landscape snapshot; the settings dialog also showed Letter / Landscape / 25mm. Restored A4 / Portrait / 20mm through the dialog: full document exactly matched the original baseline, fresh preview returned to five pages, Saved locally confirmed. Archived in QA · Local workspace (93 top-level items).

Related automated regression: 4 files / 98 tests passed. No product code changed. Full suite/type/build baseline retained at 132 files / 1879 tests; not rerun unnecessarily.

Evidence scope: actual in-app preview, UI transitions, undo/redo and local persistence. No native PDF exported or per-page visual approval claimed. Safari 101% and the remaining native gates are still open. Existing user documents were not edited.
