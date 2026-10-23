# Workspace typing profile — issue #66

## Decision

Split the workspace subscription by what the UI displays. In the browser
baseline, the whole workspace subtree's React render plus layout-effect P95
was 7.0–8.1 ms on 4000 paragraphs, exceeding the issue's approximately 4 ms
budget. After the change, the same measure was 0.2–0.5 ms. This warrants the
small subscription change; it does not warrant rewriting the editor or adding
a state library.

`useEngineSelector` owns frame coalescing, subscription cleanup and cached
snapshots in the UI layer. Its primitive selectors let React skip unchanged
values. The workspace's chrome depends on selection formatting, command
availability, document attributes and history, rather than every caret offset
while typing. Nonempty selections retain document-revision invalidation because
their formatting can span arbitrary content.

Character counts, selection counts, notes and outline render independently.
The outline reads `engine.outline()` and resolves a heading's current position
when clicked. An edit before an unchanged heading therefore cannot leave a stale
jump target. The engine remains UI-agnostic, and its existing editing, history
and persistence contracts are unchanged. The first edit may still update the
toolbar's undo availability; autosave status and other real UI changes may still
rerender the parent.

## Method and results

Measured on 2026-10-17, baseline commit
`dad346695fc579009ba090cf961f5e69d4ecd032`, Chrome 152 / macOS, eight logical
processors reported by the browser, visible foreground tab. The production
profiling build mounts the real workspace, CSS, ProseMirror editor and IndexedDB
autosave. Each document contains 200 or 4000 plain paragraphs. Each run inserts
`x` at the start of the first paragraph every 50 ms for five seconds and then
allows 100 ms for the last scheduled commit. There are three recorded runs for
each size before and after. All report `hidden: false`.

The production React profiling renderer records the **entire subtree**, including
child-only commits. These numbers are render plus layout-effect duration **per
React commit**, not complete DOM commit duration or summed work per frame.
They include the first undo-state update. Values below are the three runs in
chronological order, rounded to two decimals; none of the recorded outliers was
removed.

| Paragraphs | Version | React P95 (ms) | Instrumented work / input (ms) | Inputs completed | Long tasks >50 ms |
| --- | --- | --- | --- | --- | --- |
| 200 | Before | 4.60 / 4.40 / 3.80 | 5.20 / 5.63 / 3.63 | 100 / 100 / 99 | 0 / 0 / 0 |
| 200 | After | 0.30 / 0.30 / 1.30 | 2.81 / 2.88 / 6.36 | 100 / 99 / 92 | 0 / 0 / 4 |
| 4000 | Before | 7.00 / 7.60 / 8.10 | 19.53 / 14.56 / 21.93 | 82 / 89 / 83 | 7 / 3 / 10 |
| 4000 | After | 0.50 / 0.20 / 0.20 | 14.04 / 4.68 / 4.59 | 94 / 99 / 99 | 3 / 0 / 0 |

Selector computations outside React are instrumented in the benchmark build and
included in the after-work totals, so simply moving computation outside React
does not make it disappear from that measure. The median of the three React P95
values falls from 7.6 to 0.2 ms for the large document, and from 4.4 to 0.3 ms for
the small document. The useful conclusion is reduced React work during steady
typing, not elimination of every long task. One small-document after run had
four long tasks and higher total work despite low React cost. This single-machine
experiment does not attribute those tasks or establish cross-device performance.

Raw commits, dispatch/input samples, selector statistics, frame statistics,
long-task timestamps and environment are in
[results-2026-10-17.json](../tools/workspace-profile/results-2026-10-17.json).
[Reproduction instructions](../tools/workspace-profile/README.md) describe the
standalone production client build and how to run the baseline in another worktree.

### Measurement limits

The instrumented work column is an approximate wall-time sum of synchronous
input/DOM-observer processing, React rendering/effects and selector callbacks.
It can include forced layout and overlapping selector/render work. It is **not
Chrome's total scripting time**, and excludes uninstrumented callbacks, passive
effects, GC and paint. Dispatch timing is a subset of the input timing and is
not added twice. The harness does not collect a Chrome DevTools trace or full
commit-phase attribution; exact total scripting and per-frame attribution from
the issue's suggested Performance-panel workflow remain unmeasured here.

This is the production client code with React's profiling renderer, not a
Vinext server/SSR benchmark. Input uses the browser's native contenteditable
insertion command, not OS keyboard events or an IME. The regression suite
separately covers composition, focus, undo, toolbar state and document navigation.
The collected render evidence directly supports this scoped optimization;
remaining browser/layout costs are not claimed as fixed by it.

## Regression coverage

`workspace-subscriptions.test.ts` verifies that steady typing updates counts
without rerendering the toolbar, pending formatting and undo availability still
update, nonempty selections refresh formatting/counts, and a heading jump uses
its new position after preceding text changes. The existing workspace,
composition, menu-focus, toolbar and back-to-documents suites are retained.
