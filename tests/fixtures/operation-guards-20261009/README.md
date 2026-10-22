# Public operation rejection and retry acceptance — 2026-10-09

Initial fixture `source.vdoc.json`, SHA-256 `51e161a2f9ff2e87ab7cf1166e490831c30cc177b67c490f2e5e6e90ea0cce62`.

Independent import: `QA operation guards 2026-10-09`, document ID `9398cd9e-1c1e-4f5f-8bb2-aeefc2e4db8b`. Used public read_document/apply_document_operations, real UI Undo/Redo/Print and a fresh browser tab. No private editor or storage access.

| Check | Observed result |
| --- | --- |
| Valid background change followed by invalid row move to 999 in one batch | UNAVAILABLE; full document, revision and selection exactly unchanged |
| Valid rowAfter request, then identical request ID/payload retry | Secondary table 3→4 rows only once; identical result and revision; full JSON unchanged on retry |
| Same ID, changed operation | DUPLICATE; full JSON and revision unchanged |
| New ID with old revision | STALE; full JSON and revision unchanged |
| UI Undo/Redo after those rejections | One Undo exactly baseline, one Redo exactly inserted snapshot |
| Open preview, submit another stale request | 5 pages/A4 portrait, print enabled; STALE, full document and revision unchanged; return unchanged |
| Saved locally, leave, open new tab/session | Full document exactly inserted snapshot; new session, revision 0 |
| Old session with current revision 0 | STALE for changed session; full document/revision unchanged |
| Fresh session and revision request | Valid color edit succeeded; exact independently patched full JSON; UI Undo restored saved snapshot |

Separately confirmed Saved locally before each editor exit. Archived under QA · Local workspace (95 top-level items). Final stored document keeps exactly one inserted row; temporary background edit was undone. Fixture remains initial baseline.

Related tests: 3 files / 64 tests passed, `/tmp/vdoc-operation-guards-targeted.log`. No product or test code changed; full/type/build baseline remains 132 files / 1879 tests. This does not prove indefinite retry retention (engine cache is bounded to 200 IDs), cross-session replay, native IME, native crash/quota behavior, or Safari PDF acceptance. Preview check tested stale request rejection, not an unconditional write lock: preview uses a snapshot.
