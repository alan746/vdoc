# Preview hard-break acceptance — 2026-10-09

Independent fixture: `source.vdoc.json`, SHA-256 `3fb9c738314f2dbb762dc8604b3065134406e554516a51f3bac29a731e8caaad`.

Imported into the in-app browser as `QA preview hard breaks 2026-10-09`, document ID `e43fc2a2-cccd-471f-854b-2f914e4924aa`. Contains a heading, a numbered list starting at 7, 15 body table rows with a pinned header, and a final paragraph. Mixed Chinese/Arabic/Japanese text and consecutive explicit hard breaks are included.

The actual preview completed as **3 pages, A4 portrait**, with Print / Save PDF enabled. Selected page 3 successfully. Returned to editing: complete public `read_document` JSON matched the pre-preview baseline. After separately confirming Saved locally, exited and opened a fresh browser tab: a new session returned the same complete document JSON and Saved locally. Archived the independent sample under QA · Local workspace (88 top-level items).

This confirms the strengthened integrity guard accepts this real pagination flow. It does not establish a native PDF result or visual approval of every page. A read-only attempt to inspect iframe DOM was unavailable in the browser tool; no iframe DOM counts or screenshot claims are made. Safari 101% printing remains unresolved.
