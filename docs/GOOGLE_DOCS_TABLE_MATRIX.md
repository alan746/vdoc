# Table capability matrix

This matrix describes implementation scope and limits. It does not establish pixel-level or performance equivalence with another editor.

| Capability | Scope |
| --- | --- |
| Insert grid | Shared controls and validated row/column limits |
| Add/delete rows and columns | Shared menu, context-menu, and operation paths |
| Merge/unmerge | Grid validation and atomic rejection |
| Subdivide ordinary cell | Separate row/column subdivision operation |
| Row height | Minimum height; content may require more space |
| Column width | Logical-column updates across spans and drag controls |
| Distribution | Validated row heights and column widths |
| Borders/backgrounds | Physical edges, synchronized shared borders, colors, widths, and styles |
| Padding/alignment | Shared cell and inline table properties |
| Sorting | Language-aware comparison, protected pinned rows, no merged data rows |
| Movement | Stable identities, span checks, and pinned-boundary protection |
| Headers | Explicit pinned prefix independent of header-cell styling |
| RTL | Stable logical indices with mirrored visible order |
| Row page breaks | Per-row split preference independent of nested tables |
| Preview | Isolated pagination and repeated headers |
| DOCX | Supported structure/properties within conversion limits |
| Floating tables | Not implemented |
| Text wrapping | Not implemented |
| Nested pagination | Limited; inspect artifacts for complex cases |

Record grid geometry before and after operations. Check the intended table when opening a context menu at a new selection. Undo restores content, IDs, dimensions, spans, and row attributes together.

Styling and pinning are independent. Coordinates remain logical under RTL; left/right border names mean physical edges. Preview page breaks are layout results rather than document indices.

See [table acceptance](TABLE_ACCEPTANCE.md), [operations](OPERATIONS.md), and [native acceptance](NATIVE_ACCEPTANCE_RUNBOOK.md).
