# Long multilingual export filenames

Actual in-app browser downloads, 2026-10-09. The controlled QA document was
`426baac0-0752-4b13-9b77-ce75fc6d7931`; its temporary title was `QA 文件名 `,
followed by 90 copies of `中`, then `👩‍💻café` (combining final accent).

The JSON download filename used 239 UTF-8 bytes including `.vdoc.json`;
the Word filename used 240 bytes including `.docx`. Both files were found
in Downloads after actual clicks and copied here with short fixture names.
Original filenames and SHA-256 hashes are in `manifest.json`.

The backup JSON title and DOCX `docProps/core.xml` title both match the full
temporary title. Both bodies contain the initial multilingual paragraph,
the table's `Do not overwrite the source document`, and the complete final
`BACKUP_END — keep this line intact.` marker. This is archive/content evidence,
not a desktop Word rendering test. JSON parsing/complete content round-trip
and grapheme-boundary truncation also have automated regression coverage.

After export, the QA title was restored to
`QA backup isolation · Editor import 2026-10-08`. Public `read_document` full
document JSON matched the initial snapshot, and Saved locally was confirmed.
The original Downloads files were retained.

The 240-byte limit is an application policy for suggested download names,
not a guarantee about every filesystem or full path. Control characters,
trailing dots and reserved device names are handled with reference to
[Microsoft's filename rules](https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file).
No Windows download, crash, real quota exhaustion, native IME, or Safari
print acceptance is implied by this evidence.
