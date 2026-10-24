# Multilingual and Unicode acceptance

Recorded coverage includes 40 language samples and targeted Unicode boundaries. It does not establish every language, font, dictionary, or operating-system input method.

## Covered behavior

- NFC-equivalent search maps matches to original UTF-16 offsets without rewriting source text.
- Search, replacement, and explicit targets respect complete grapheme boundaries.
- Whole-word search uses runtime Unicode segmentation.
- Counts use grapheme clusters; title truncation preserves complete clusters.
- Paragraph direction accepts `auto`, `ltr`, and `rtl`.
- Table column direction is independent of cell text direction.
- Validated BCP 47 language tags persist through supported formats.
- Backups retain exact strings, combining marks, and joiners.

## Samples and verification

Exercise composed/decomposed accents, emoji sequences, skin-tone modifiers, regional indicators, Hangul Jamo, supplementary letters, Indic combinations, joiners, and mixed Arabic/Hebrew/Latin/numeric text. Keep original strings in executable fixtures.

| Layer | Check |
| --- | --- |
| Operations | Insert, style, replace, undo, and exact backup equality |
| Conversion | DOCX text, direction, and formatting |
| Browser | Selection, search visibility, font fallback, and layout |
| Native input | Candidate windows, cancellation, movement, and commit |
| PDF | Extraction, selection, search, exact order, glyph mapping, and independent readers |

`Intl.Segmenter` and runtime Unicode data determine segmentation. Browser spelling depends on dictionaries. Language metadata does not install an input method or translate text.

Native composition and multilingual PDFs require platform evidence. See [native acceptance](NATIVE_ACCEPTANCE_RUNBOOK.md) and [PDF experiments](../tools/pdf-export/README.md).
