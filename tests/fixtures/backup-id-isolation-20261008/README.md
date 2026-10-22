# Backup identity isolation — actual browser acceptance

Executed 2026-10-08 in the Codex in-app browser at `http://localhost:5173/`. Production code unchanged.

The controlled [source.vdoc.json](source.vdoc.json) deliberately contains the ID of an existing QA document (`ccaaf28a-efe5-4938-8332-5bdc61910976`) but different content. SHA-256: `2a48d1268f8d4a9a3cb55be0a46d959f1af0082cfa368ee6d6dd77ee44851851`. It contains multilingual text, a two-column table and an ending marker. No personal document content is used.

| Route | New document ID | Final QA title | Result |
| --- | --- | --- | --- |
| Editor File → Import document → real file chooser | `426baac0-0752-4b13-9b77-ce75fc6d7931` | QA backup isolation · Editor import 2026-10-08 | Independent document; real keyboard editing, exact Undo / Redo; edit survives reopening |
| Home Import → real file chooser, same backup again | `f7c34a3a-f9cd-4da1-a72d-8a1ba0e8d32e` | QA backup isolation · Home import 2026-10-08 | Independent document; original backup content preserved despite edits to first copy; full JSON survives reload |

Both imports initially used the same backup title. The two baseline document structures are identical after excluding only regenerated `blockId`, `cellId` and `tableId`. Exact full-JSON comparisons were used for changes and reloads within a single document.

The first copy received a real keyboard `x` insertion. Undo returned its full JSON exactly to the imported state; Redo exactly restored the edited state. After saving, returning home and importing the second copy, reopening the first via File → Open local document recovered its own edited JSON. The second copy retained the untouched backup content. Finally the first copy's test character was removed through the public operation API; full JSON again equaled its import baseline, and Saved locally was observed.

The original QA document referenced by the backup ID was reopened through File → Open local document. Its full JSON, original title and document ID matched the pre-test baseline. Neither importer overwrote it. Its save timestamp may change through normal navigation; no assertion of byte-identical storage metadata is made.

Both new copies were renamed for clarity and moved through the visible library UI to **QA · Local workspace**. The folder listed both final titles; the original document remains unchanged. No document was deleted.

Relevant existing import regressions were run separately; see `/tmp/vdoc-backup-identity-import.log`. This is real browser import/edit/persistence evidence, not native IME, crash recovery, quota exhaustion or Safari PDF verification.
