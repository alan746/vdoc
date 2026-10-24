# Combined workflow acceptance

## Fixed workflow

1. Import the reference document through the library file input.
2. Edit headings, paragraphs, lists, and mixed-format text.
3. Modify a table containing headers, merged cells, and different widths.
4. Insert an image, footnote, and explicit page break.
5. Search, replace, and undo while checking selection and focus.
6. Save a version, continue editing, and restore the checkpoint.
7. Export JSON, DOCX, TXT, and PDF through the interface.
8. Reopen the downloaded files and compare with the paired backup.
9. Refresh and reopen the library entry to check persisted state.

Use an independent QA copy. Record document IDs, hashes, browser settings, and revision.

## Data safety

Autosave uses a 450 ms idle delay and a two-second maximum scheduling wait during continued input. Writes are serialized and merge the latest pending state. Storage errors must produce visible feedback without a tight retry loop. Switching and teardown cancel obsolete work.

Test quota failure, interrupted writes, and recovery separately. Verify both the existing persisted document and current draft. Scheduling does not guarantee durability after immediate termination.

## Files and output

Check text, direct formatting, numbering, links, images, spans, direction, footnotes, and page settings. Word defaults must not unexpectedly inherit unrelated theme colors or fonts. Import errors and cancellation must leave the current document intact.

Compare complete JSON for lossless paths. Inspect DOCX in an independent reader for visual fidelity. Pair PDFs with their exact source; check every page, repeated headers, row counts, and the last content marker.

See [validation](VALIDATION.md), [text acceptance](TEXT_ACCEPTANCE.md), and [table acceptance](TABLE_ACCEPTANCE.md).
