# Workspace browser profile

This isolated Vite production build mounts the real `VdocWorkspace`, editor,
styles and IndexedDB autosave. It substitutes React's production profiling
renderer for `react-dom/client`; it does not change the shipping application.
Use a separate localhost origin so the generated documents do not enter your
normal document library.

```sh
npm ci
npx vite build --config tools/workspace-profile/vite.config.mjs
npx vite preview --config tools/workspace-profile/vite.config.mjs
```

Open `http://127.0.0.1:8770/?paragraphs=200`, keep the tab visible and click
**Run 5-second typing profile**. Wait for the button to become enabled before
repeating. Run three times, then repeat with `?paragraphs=4000`. Each page load
creates a fresh document; repeated runs insert additional characters in its
first paragraph. Avoid running builds/tests at the same time.

The preview server saves raw results under `dist/workspace-profile/results/`.
Copy them before another build, which clears that output directory. These files
contain generated test text timings, not users' documents. Stop the preview
server when finished.

For a baseline, use a separate worktree at the commit being compared, copy this
tool directory into it, install that commit's lockfile, and run the same commands.
The recorded baseline for #66 is `dad346695fc579009ba090cf961f5e69d4ecd032`.

## What is measured

- Native `contenteditable` insertion through `document.execCommand('insertText')`
  every 50 ms for five seconds. ProseMirror's real DOM observer reconciles it.
  This is deterministic browser-generated input, not OS keyboard/IME simulation.
- React `Profiler` render duration for the whole workspace subtree, including
  child-only commits; layout-effect duration is recorded separately using the
  React 19.2.6 profiling renderer's `onCommit` callback. Neither is the duration
  of the complete DOM commit/paint. Several React commits can occur in one frame.
- Input through the next microtask (including DOM-observer reconciliation),
  ProseMirror dispatch duration, frame intervals, and browser long tasks.
- A build-only transform measures selector callbacks outside React. The ordinary
  app has no performance instrumentation. This prevents moving computation out
  of React from being mistaken for eliminating that work.

The legacy JSON field `observedScriptingMsPerKey` is an **instrumented wall-time
sum**, not Chrome Performance's total scripting metric: input + React render and
layout effects + selector callbacks, divided by inserted characters. Input can
include forced layout; selector work during React may overlap its render sample.
Other event callbacks, passive effects, GC and paint are not comprehensively
attributed. Dispatch is a subset of input and is **not** added again. Baseline
results predate the selector instrument (the baseline has no selectors).

This harness uses the actual production client modules, not the full Vinext
server/SSR deployment, and it does not export a Chrome DevTools trace. For exact
total scripting/commit-phase attribution, record the same workload in Chrome's
Performance panel. The report deliberately does not label these partial timings
as that measurement. See [the decision and results](../../docs/WORKSPACE_PROFILING.md).
