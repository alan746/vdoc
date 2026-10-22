# Multiline Word footnotes — 2026-10-09

Independent QA documents; existing user documents were not edited.

- `source.vdoc.json`: imported through the homepage file chooser.
- Source ID: `38e42e95-083e-49e7-9aaa-cf364bf72748`, title `QA footnote roundtrip 2026-10-09`.
- `downloaded.docx`: exact copy of the real downloaded file, 10285 bytes; SHA-256 `04c528fee02f92d86d77ffaee1ca628f118c419a1197054e9fde02e6791b873c`.
- Reimport ID: `512ac9dc-1d55-4e29-9dc9-2bf8a77f73b7`, title `QA footnote Word reimport 2026-10-09`.
- Both documents were moved to `QA · Local workspace` after acceptance.

The downloaded Word footnotes part contains six explicit carriage returns and two tabs. The file was imported through the actual file chooser. DOM data-note values and public read_document confirmed both notes exactly match the source, including blank lines, tab indentation, leading/trailing spaces, Chinese/Arabic/Japanese/Indic text, combining accents, emoji and a literal arrow. The merged cell remains colspan=2 and body start/end markers remain present. The page uses pre-wrap for the notes section.

Public full document JSON was unchanged by source export. Reimport was saved locally, refreshed, and full document JSON was unchanged after refresh. No private editor or storage APIs were used.

This verifies editable plain-text footnotes, not rich note formatting, desktop Word visual pagination, Safari printing, native IME, actual quota exhaustion or process-crash recovery. Those native acceptance gates remain open.
