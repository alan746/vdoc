# Word quote structure round trip — 2026-10-09

Independent samples; existing user documents were not edited.

- `source.vdoc.json`: imported through the homepage file chooser.
- Source ID `09e33b68-6526-4ac9-8ac4-5bfe707349ef`, title `QA quote roundtrip 2026-10-09`.
- `downloaded.docx`: exact copy of the real download, 10568 bytes; SHA-256 `4a4a26fac5afb04145f40de7fa481d3352da8ffab0b9ce9ed214bb7bae6192f1`.
- Reimport ID `26c48867-d1f0-4095-8a42-18f65db7a0f1`, renamed `QA quote Word reimport 2026-10-09`.
- Both samples moved to `QA · Local workspace`.

The downloaded DOCX contains six tagged block content controls, including one tagged with outer list level 0. It contains no temporary import marker paragraphs. The real downloaded file was imported through the homepage chooser.

DOM verifies six blockquotes, one quote within a list item, one within a merged table cell, and one table within a quote. Merged colspan remains 2. Public read_document confirms all node types, nesting and text equal the source (attributes and regenerated IDs are deliberately not compared across Word conversion). Source full JSON is unchanged after export. Reimport was saved locally and refreshed; full JSON is exactly unchanged across refresh.

Regression tests additionally cover current text edits made in DOCX XML, missing marker pairing without content loss, unrecognized content-control tags, RTL paragraph indentation, tabs, headings, links/notes, code, dividers and page breaks. Word paragraph indentation conveys quotes, but desktop Microsoft Word rendering and full visual parity have not been verified. If another editor strips the private quote tag, text remains but quote grouping may not survive. Native Safari/IME/crash/quota gates remain open.
