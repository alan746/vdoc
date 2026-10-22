# Native isolated host crash evidence — 2026-10-10

Environment: macOS 26.6.2 (25G83), development-only WKWebView host built from
`tools/native-qa/main.swift`. Separate persistent store
`36A96756-6C93-43C3-932C-A4969A453A88`; no Safari profiles or personal tabs accessed.
This is an isolated WebKit host test, not a Safari-process or power-loss test.

## Saved document: passed

- Normal VDoc Import selected `examples/final-native-acceptance.vdoc.json`.
- Normal title/body UI set `QA isolated crash 2026-10-10` and
  `CRASH_SAVED_20261010_A`. Observed `Saved locally`, 2439 characters.
- Actual VDoc File → Download VDoc backup created `before.vdoc.json`.
- Host PID 44484 was terminated by SIGKILL at 07:21:38 UTC, then restarted as
  PID 47018 at 07:22:31 with the same isolated store.
- Library retained the document. Downloaded `after-saved-crash.vdoc.json` from
  the recovered editor. Title and **entire content JSON** compare equal,
  including 37 table rows, merged cells, one image and one page break.

## Immediate input: passed

An initial shortcut probe used Cmd-Shift-J, which conflicted with the editor's
justify shortcut. Its `x` was undone, but paragraph alignment remained justified.
Do not compare this intermediate result against the earlier unmodified baseline
and ignore the difference. Removed the host's conflicting shortcut.

`before-immediate.vdoc.json` is the actual downloaded baseline after that known
format change. In the clean repeat, selected the insertion point after the saved
marker, armed the explicit QA menu action and delivered `x`. Host PID 51710
logged the input-triggered 150 ms SIGKILL schedule and termination at 07:38:03.
Relaunched as PID 52357, opened the same document: saved marker remained, the
extra `x` was absent and the page reported 2439 characters.

The final backup destination was requested at 07:39:19:
`tmp/native-qa/downloads/1791617959-1-QA isolated crash 2026-10-10.vdoc.json`.
The native controller initially timed out, but the actual download completed at
07:46:49 UTC (160737 bytes). It is preserved as
`after-immediate-crash.vdoc.json`, SHA-256
`9a01b2b86ea6a12981fba710a1560d17ddf7e24acb43d338d62856e2b9f2d11e`.
The audit now confirms title and entire content JSON equal to
`before-immediate.vdoc.json`. The last uncommitted `x` was lost; the saved
document, including all table structure, image and page break, was preserved.

## Recheck

```sh
node tests/fixtures/native-crash-20261010/audit.mjs
```

`audit.json` records current results; `events.log` retains the observed host
events. The harness terminates only itself, not WebKit's storage service. The
150 ms host schedule is before VDoc's normal 450 ms idle autosave delay; exact
IndexedDB transaction-phase interruption has not been established. No zero-loss
claim is made for unsaved input. No real quota exhaustion was performed.
