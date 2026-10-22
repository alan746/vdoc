# Complex table editing cycle — 2026-10-09

Initial fixture `source.vdoc.json`, SHA-256 `2b257a36a1daa9f8faebcedbf78267ca3b9c4f254296fb5e3c82d06a41e2c054`.

Independent import: `QA table editing cycle 2026-10-09`, ID `4bc3d52b-7a7c-4465-8008-0f4b8233bb81`. Main table has 37 rows, RTL secondary table 3 rows, nested table 2 rows.

Used public read_document/apply_document_operations with current session/revision and explicit cell targets; Undo/Redo and Print used actual UI buttons.

- Main table merged cell at logical row 1/column 0: background #FFF2CC, padding 8, verticalAlign top applied as one batch. Compared complete JSON with an independently patched baseline: only those three attributes changed. Undo/Redo matched complete snapshots.
- Merged the two empty RTL cells in row 1 into colspan 2. Main table unchanged, RTL preserved.
- Inserted a row after the merged row: secondary table became 4 rows, new row had two ordinary empty cells; nested table snapshot unchanged.
- Real preview completed as 5 pages/A4 portrait, print enabled. Return preserved complete JSON.
- Undo inserted row, Redo inserted row, Undo inserted row, Undo merge and Redo merge each returned exact expected full JSON.
- Separately confirmed Saved locally, exited, then opened a fresh tab/session. Full document exactly matched the edited style+merge snapshot and showed Saved locally.
- Archived under QA · Local workspace (94 top-level items). Final archived document intentionally keeps the style and RTL merge; inserted row is undone. The fixture file remains the initial baseline.

Related tests: 4 files / 74 tests passed. Product unchanged; latest full/type/build baseline remains 132 files / 1879 tests. No user-existing document was edited. These results do not establish mouse-drag selection, native IME, or Safari PDF acceptance.
