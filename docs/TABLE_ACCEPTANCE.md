# Table acceptance

## Structure and styling

Create small and large grids; add/remove rows and columns; merge/unmerge; subdivide an ordinary cell; and delete tables. Verify text, spans, IDs, and neighbors. Invalid requests leave the entire batch unchanged.

Check dragged widths, minimum heights, distribution, padding, alignment, colors, physical borders, and vertical alignment. Shared edges agree. Drag previews must not add document revisions.

## Headers, movement, and direction

Test explicit pinning/unpinning, structural changes inside the prefix, undo, and independent header styling. Sorting preserves pinned rows and rejects unsupported merged regions.

Move logical rows/columns while retaining content, identity, geometry, and attributes. Reject broken spans and protected-boundary crossings. Repeat direction-sensitive cases with RTL order.

## Pagination and files

Check repeated headers, row splitting, explicit heights, merged cells, nested content, and unequal fragments. Inspect every PDF page for missing/duplicate rows and header-only pages. Recheck ordinary samples after stress cases.

Reopen JSON and DOCX. Confirm structure, formatting, row attributes, language, direction, and identities within format limits. Header styling and pin metadata are not fully interchangeable across formats.

See [the capability matrix](GOOGLE_DOCS_TABLE_MATRIX.md), [native printing](NATIVE_ACCEPTANCE_RUNBOOK.md), and [operations](OPERATIONS.md).
