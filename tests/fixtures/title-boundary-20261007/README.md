# Long-title browser acceptance — 2026-10-07

These are generated QA inputs, not user documents. Exact filenames, expected import titles and local test document IDs are in `manifest.json`.

- Import the TXT and DOCX through the homepage Import file chooser. Each filename has a 119-code-unit ASCII prefix followed by a multi-code-unit grapheme and a suffix. The resulting title must equal the prefix, with no broken trailing character.
- TXT contains three paragraphs, including its final empty paragraph. DOCX contains two paragraphs, with the first bold. Both contain mixed-language and Unicode text.
- Rename the TXT title to `('QA 20261007 TXT COPY ').padEnd(111, 'a') + '😀 Z'`; rename DOCX to `('QA 20261007 DOCX COPY ').padEnd(111, 'a') + 'e\u0301 Z'`.
- Use each homepage menu's Make a copy. Expected title is `Copy of ` plus the respective 111-code-unit prefix, length 119. The next complete grapheme cannot fit within the 120-code-unit limit.

Actual in-app browser results: both imports, both copies, full document JSON comparisons, reloads of both copies, and reopening both sources passed. The original titles retain their complete emoji/combining accent; source body JSON stays unchanged. The DOCX copy at a 1280px viewport has document scroll width 1280px. All four documents are retained under `QA · Local workspace` for inspection. No user document was changed.

These checks do not establish native IME candidate behavior, Safari print/PDF output, process-crash recovery or actual storage quota exhaustion. No production code changed in this verification batch.
