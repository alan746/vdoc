# Acceptance checklist

This checklist separates implementation from verification. Record the revision, browser, operating system, sample, and evidence for each run.

Use **passed** for a stated case with matching evidence, **partial** for limited coverage, **pending** for an unverified implementation, **missing** for an absent capability, and **blocked** when the required environment is unavailable.

| Area | Cases |
| --- | --- |
| Library | Create, rename, search, sort, move, copy, favorite, trash, restore, and permanent deletion |
| Persistence | Continued input, refresh, switching, write failures, recovery, and version restore |
| Text | Formatting, headings, paragraphs, lists, links, quotations, footnotes, and code blocks |
| Tables | Structure, movement, dimensions, borders, pinned headers, sorting, and RTL order |
| Selection | Menus, dialogs, cancellation, focus restoration, shortcuts, and stale selections |
| Languages | Grapheme boundaries, title limits, direction, language tags, and native composition |
| Imports | Valid and damaged JSON/DOCX/TXT, cancellation, limits, errors, and title boundaries |
| Exports | Actual downloaded files, contents, prepared links, and independent reopening |
| Printing | Pagination, headers, numbers, images, tables, final-page content, and scale |
| Voice | Connection, permissions, progress, interruption, reconnect, targets, and turn undo |
| Cloud | Sign-in, ownership, account isolation, quotas, and expired sessions |

## Evidence boundaries

A conversion test verifies its data path. A native file-picker test verifies user delivery. Preview verifies its snapshot. A PDF check verifies the exported file. A storage mock does not establish crash durability or real quota behavior.

Run complete workflows on independent QA copies. Keep original samples unchanged and retain source backups with output files.

Procedures: [text](TEXT_ACCEPTANCE.md), [tables](TABLE_ACCEPTANCE.md), [combined workflows](COMPLEX_WORKFLOW_ACCEPTANCE.md), [languages](MULTILINGUAL_ACCEPTANCE.md), and [native runs](NATIVE_ACCEPTANCE_RUNBOOK.md). Historical evidence is indexed in [QA_EVIDENCE.md](QA_EVIDENCE.md).
