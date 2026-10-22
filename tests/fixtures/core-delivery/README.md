# Core file delivery acceptance 2026-10-04

`source.vdoc.json` is a QA-only copy of the round-49 multilingual merged-table
sample with a newly generated, valid 300×150 blue/orange PNG. The old sample's
tiny PNG has an IDAT CRC error and remains unchanged in `local-download/` for
historical import coverage. It must not be cited as successful image rendering.

The new source was imported through VDoc's page file chooser, exported through
the File menu, and actually downloaded as `QA core valid image delivery.docx`.
`downloaded.docx` preserves those downloaded bytes. This same file was then
reimported through the editor's file chooser. English/Chinese/Japanese/Arabic,
the two-row merged cell, 300×150 image, and image alt text were retained.

Bundled LibreOffice rendered the Word download to one page. Visual review
confirmed all text scripts, both colored image squares, and the merged table.
Rendering used an isolated Fontconfig file pointing to macOS system fonts;
no user font settings were changed. This is independent DOCX render evidence,
not a Microsoft Word compatibility certificate or a VDoc browser-printed PDF.

SHA-256:

- source.vdoc.json: `e14d0f298fe82f5ea3fbbb5e27cadf3410d5a6cb164f2fe06e3ac5e5c6ee72d2`
- downloaded.docx: `5d6e3f2151fed84d5fa13a0ae2cf0002223c0a9bbab9b675d83a07ca13ba11e4`
