# Lazy block-index typing benchmark

This opt-in jsdom benchmark measures the actual `DocumentEngine` transaction
handler separately from Tiptap's complete `insertContent('x')` call. Each of
three runs creates 4000 paragraphs and one table, waits for initial normalization,
constructs the engine, warms up with 20 inputs and records another 100 inputs.
There are no index readers between inputs. The benchmark wraps the existing
registered handler only in test code; it does not add a public engine API.

```sh
VDOC_BENCH_RESULT=/tmp/vdoc-block-index.json npx vitest run --config tools/block-index-benchmark/vitest.config.ts
```

Run serially, outside other builds/tests. To reproduce the before/after comparison,
copy this directory into a separate worktree at baseline commit
`c7a35c2`, install that worktree's dependencies (including its ProseMirror patch),
then run the same command before and after the lazy-index change. This benchmark
is outside the normal CI test include pattern; it has no timing-based pass/fail
threshold. The normal block-index tests instead assert rebuild counts and content
preconditions deterministically.

The measurement isolates transaction-handler work, not browser layout, React,
rendering latency or the deferred read. A UI or API reader still pays one rebuild
when it first reads a changed document. Constructor indexing is retained and is
outside the measured input loop. See `results-2026-10-17.json` for raw samples.

## Recorded comparison, 2026-10-17

Node 24.13.0 / jsdom, on the same macOS machine and lockfile, three serial runs.
All values are milliseconds. The latest main baseline already includes the
ProseMirror view patch from #86; it is therefore faster than the older whole-input
baseline quoted in #59.

| Version | Handler median, runs 1 / 2 / 3 | Handler P95, runs 1 / 2 / 3 | Whole input median, runs 1 / 2 / 3 |
| --- | --- | --- | --- |
| Before | 0.514834 / 0.484416 / 0.486791 | 0.595667 / 0.585458 / 0.591208 | 1.101833 / 1.005042 / 0.977208 |
| After | 0.001750 / 0.001541 / 0.001584 | 0.003125 / 0.004542 / 0.002709 | 0.562125 / 0.510417 / 0.501541 |

The handler's median-of-run-medians falls from 0.486791 to 0.001584 ms.
The remaining work includes revision/bookmark handling and selective undo
recording. The deferred rebuild cost is not eliminated or included in these
no-reader timings; readers still pay for the current document when needed.
