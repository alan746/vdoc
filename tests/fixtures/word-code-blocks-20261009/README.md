# Code blocks through an actual Word download and reimport

Verified 2026-10-09 in the in-app browser. `source.vdoc.json` is a new, isolated
sample containing one body code block and another inside a two-column merged
cell, surrounded by ordinary paragraphs. No existing document body was replaced.

The sample was imported through the homepage file chooser as
`8c245e60-7513-46e0-96e3-5b87cc37bcab`, title
`QA code block roundtrip 2026-10-09`. The actual File → Download Word result
was saved in Downloads and copied byte-for-byte here as `downloaded.docx`.
SHA-256: `8371d96536cf05eef22ce09d4a9aadd5fa3bd527484f38ab71e674bd309dbfcd`.
Each of its two `VDocCodeBlock` paragraphs has four `w:cr` breaks and three
`w:tab` elements. The source document JSON was unchanged by export.

The downloaded DOCX was reimported with the homepage's real file chooser as
`bd36bbd8-0324-4487-ae73-25ab74f328c8`, renamed
`QA code block Word reimport 2026-10-09`. Public document reads confirmed two
codeBlock nodes with text exactly matching the source, including tabs, spaces,
an interior blank line, a final newline, Chinese, Arabic, Japanese, Indic text,
emoji and combining accent. DOM inspection confirmed the merged cell retains
colspan 2 and the surrounding text markers remain present. Saved locally was
confirmed; both new samples were moved to `QA · Local workspace`.

The initial proposal to temporarily replace an existing QA paragraph was
rejected by automatic approval review because restoration had not been proven.
That operation was not retried; the independent new sample above supplied the
safer test path. The original QA title/save state were checked unchanged.

This is DOCX structure and application round-trip evidence, not desktop Word
visual pagination, syntax-highlighting/language-metadata fidelity, or Safari
native printing acceptance.
