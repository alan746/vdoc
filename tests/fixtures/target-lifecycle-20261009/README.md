# Deleted targets, restoration and document isolation — 2026-10-09

Independent fixtures and actual imported documents:

| Sample | SHA-256 | Document ID |
| --- | --- | --- |
| source-a.vdoc.json | a5e06d1459264c6f3bf227df8059f817c8fc2797b7b98d0e0c41a515e5a5da58 | 6a05bd38-27d0-4080-b3f5-461d08befd5d |
| source-b.vdoc.json | 463bc87a5b05b4b4e78a470811ac837b653743678079234e67e259a977f7e172 | 54656b6d-87f6-4c88-b511-741923f6e62d |

Titles: QA target lifecycle A/B 2026-10-09. Main table 37 rows, RTL secondary 3 rows, nested table 2 rows. Only these newly imported samples were edited. Public read_document/apply_document_operations supplied session, revision and explicit targets; Undo/Redo/import/navigation used UI.

- A: delete RTL empty row 1. Secondary table became 2 rows; FINAL GRID A occupied the former row 1/column 0. A fresh-revision request carrying the deleted cell ID returned TARGET and left full JSON/revision unchanged.
- UI Undo restored exact initial full JSON and original cell identity. Fresh-revision edit to that restored ID applied #E1F5FE only to the original cell, matching an independently patched full JSON. Undo restored baseline.
- Nested cell ID paired with outer table ID returned TARGET with full JSON/revision unchanged.
- Delete nested table: only two table snapshots remained; main table snapshot unchanged. Fresh-revision write to deleted nested target returned TARGET, full JSON/revision unchanged. Undo exactly baseline, Redo exactly deleted snapshot, Undo exactly baseline.
- Confirmed Saved locally separately, exited A, imported B in the same browser tab. A/B initial revisions were both 0 and the chosen main-table cell/table IDs existed in both documents. An A-session request with B's current revision returned STALE, leaving B full JSON/revision unchanged.
- A request using B's own session/revision changed only the chosen cell background to #E8F5E9 and padding to 9; full JSON matched an independently patched baseline.
- After separate Saved locally confirmation and exit, fresh-page reads proved A exactly original and B exactly edited; both used new sessions and showed Saved locally.
- Both archived under QA · Local workspace (97 top-level items). A retains its initial content; B deliberately retains the one-cell style batch.

Related tests: 3 files / 57 tests passed (`/tmp/vdoc-target-lifecycle-targeted.log`). No production or test code changes; full/type/build baseline remains 132 files / 1879 tests. This is local single-user acceptance, not simultaneous editing or cross-tab conflict resolution. Native IME, Safari PDF, real crash/quota and final signoff gates remain open.
