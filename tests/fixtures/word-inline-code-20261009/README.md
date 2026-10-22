# Word inline code round trip — 2026-10-09

Independent local QA samples; no existing user document was edited.

- `source.vdoc.json`: imported through the homepage file chooser.
- Source document: `2b757ae8-d14c-4eb6-bc36-0778b139597c`, title `QA inline code roundtrip 2026-10-09`.
- `downloaded.docx`: exact copy of the file downloaded by clicking the Word download link. SHA-256 `f3c3eae6a412a8b0e60fc24de98bb4c53b2bff3abf61e18fd8700c38d44a929b`, 10371 bytes.
- Reimport document: `bd6a3a14-752d-4786-83d5-4def7377fad5`, renamed `QA inline code Word reimport 2026-10-09`.
- Both samples moved to `QA · Local workspace` after verification.

The downloaded DOCX contains two VDocInlineCode runs. The downloaded file was imported through the real file chooser; DOM and public read_document returned the exact two code strings, including Chinese, Arabic, Japanese, emoji, combining accent, Indic text and the tab. The merged cell remains colspan=2; surrounding text and start/end markers remain intact. Export did not change the source document JSON. Saved locally was confirmed before refresh; public full document JSON after refresh exactly equals the pre-refresh JSON.

The first read-only reimport comparison hit an automatic approval timeout. The tool explicitly allowed one retry; the identical retry succeeded. No alternative access path was used.

This is in-app browser evidence, not native Safari printing or desktop Microsoft Word visual acceptance. The seven native acceptance gates remain open.
