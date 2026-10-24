# Core acceptance gates

Acceptance belongs to a specific revision and environment. An earlier artifact cannot close a changed case without a matching rerun.

| Gate | Required evidence |
| --- | --- |
| Editing and persistence | Edit, save, reload, switch, recover failures, and restore versions without content loss |
| File delivery | Download and reopen actual files; compare structure and important formatting |
| Printing | Pair backups with PDFs; inspect counts, headers, images, clipping, and final-page content |
| Unicode and input | Exercise composition, grapheme boundaries, mixed direction, and multilingual output |
| Responsiveness | Measure actual input, selection, search, and scrolling in a fixed long document |
| Services | Verify sign-in, ownership, lifecycle, cancellation, and quota handling |
| Joint verification | Typecheck, lint, tests, build, and Worker smoke for the same candidate |

## Evidence rules

Separate current failures, historical failures, and environment blocks. Preserve exact text comparisons for multilingual PDFs; normalization is diagnostic rather than a replacement for exact content. Extraction, search, partial selection, and visual appearance require separate checks.

Native candidate windows, operating-system downloads, termination, and real storage exhaustion require native evidence. Missing evidence remains pending.

Use [the native runbook](NATIVE_ACCEPTANCE_RUNBOOK.md), [the final worksheet](acceptance/FINAL_FIVE_ACCEPTANCE.md), and [the evidence index](QA_EVIDENCE.md).
