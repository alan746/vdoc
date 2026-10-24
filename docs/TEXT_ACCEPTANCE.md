# Text editing acceptance

## Formatting and structure

Check bold, italic, underline, strike, scripts, fonts, sizes, colors, highlights, links, and clear formatting. Cover cursors, text ranges, blocks, and cell selections. Cancelled dialogs must not reuse an old selection.

Exercise headings, alignment, direction, spacing, indentation, borders, backgrounds, and pagination properties. Check ordered/bullet/task lists, nesting, conversion, numbering, and table-cell boundaries.

## Selection and composition

Test toolbars, context menus, dialogs, shortcuts, search navigation, and focus restoration. Formatting samples must use actual selected text and skip unrelated inline atoms.

Use [multilingual cases](MULTILINGUAL_ACCEPTANCE.md) for complete graphemes, equivalent search, and title boundaries. Native candidates commit once; cancellation preserves prior text.

## Files, history, and storage

Check direct formatting, links, breaks, footnotes, lists, and tables through DOCX round trips. Verify exact JSON for lossless paths and record conversion differences. Use actual downloads to validate delivery.

Check undo/redo, atomic batches, versions, autosave, refresh, and switching. Turn undo preserves later user input or rejects an unsafe conflict atomically.

See [combined workflows](COMPLEX_WORKFLOW_ACCEPTANCE.md) and [validation](VALIDATION.md).
