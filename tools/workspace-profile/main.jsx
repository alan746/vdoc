import { Profiler, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import Workspace from '../../components/editor/workspace';
import { activateDocument } from '../../lib/infrastructure/persistence/document-store';
import { CURRENT_DOCUMENT_VERSION } from '../../lib/domain/rules/document-migrations';
import '../../app/globals.css';

// An isolated origin and fresh document per load keep the real autosave path active.
const paragraphs = Number(new URLSearchParams(location.search).get('paragraphs') || 200);
if (![200, 4000].includes(paragraphs)) throw new Error('Use paragraphs=200 or paragraphs=4000');
const saved = await activateDocument({
  version: CURRENT_DOCUMENT_VERSION, title: `Profile ${paragraphs} paragraphs`, savedAt: new Date().toISOString(),
  content: { type: 'doc', content: Array.from({ length: paragraphs }, (_, i) => ({
    type: 'paragraph', content: [{ type: 'text', text: `Paragraph ${i + 1}: A reproducible document for measuring workspace typing performance.` }],
  })) },
});
location.hash = `document=${saved.id}`;
let recording = false;
let commits = [];
const root = createRoot(document.getElementById('root'));
root.render(createElement(Profiler, {
  id: 'Workspace subtree',
  onRender: (_id, phase, actualDuration, _baseDuration, startTime, commitTime) => {
    if (recording) commits.push({ phase, renderMs: actualDuration, startTime, commitTime, layoutEffectsMs: 0 });
  },
  // React 19.2.6 profiling build exposes effect duration separately from render time.
  // This does NOT include all DOM mutation/layout/paint time.
  onCommit: (_id, _phase, duration, commitTime) => {
    const commit = commits.findLast(value => value.commitTime === commitTime);
    if (recording && commit) commit.layoutEffectsMs = duration;
  },
}, createElement(Workspace)));

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const output = document.getElementById('results');
const button = document.getElementById('run');
const stats = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return { count: sorted.length, median: sorted[Math.floor(sorted.length / 2)] ?? 0,
    p95: sorted[Math.max(0, Math.ceil(sorted.length * .95) - 1)] ?? 0,
    max: sorted.at(-1) ?? 0, total: sorted.reduce((a, b) => a + b, 0) };
};
while (!document.querySelector('.tiptap')?.editor) await delay(50);
await delay(1000);
button.disabled = false;
output.textContent = `Ready: ${paragraphs} paragraphs. Keep this tab visible. Repeat three times.`;
button.onclick = async () => {
  button.disabled = true;
  const editor = document.querySelector('.tiptap').editor;
  editor.commands.setTextSelection(2);
  editor.view.focus();
  await delay(500);
  commits = [];
  performance.clearMeasures('vdoc-selector');
  const dispatches = [], inputs = [], longTasks = [], frames = [];
  const originalDispatch = editor.view.props.dispatchTransaction;
  editor.view.setProps({ dispatchTransaction(transaction) {
    const start = performance.now();
    try { return originalDispatch.call(editor.view, transaction); }
    finally { if (recording) dispatches.push(performance.now() - start); }
  } });
  const observer = new PerformanceObserver(list => longTasks.push(...list.getEntries().map(({ startTime, duration }) => ({ startTime, duration }))));
  observer.observe({ type: 'longtask' });
  let frameId, previous;
  const frame = time => { if (previous !== undefined) frames.push(time - previous); previous = time; frameId = requestAnimationFrame(frame); };
  frameId = requestAnimationFrame(frame);
  recording = true;
  const start = performance.now();
  let keys = 0, hidden = false;
  try {
    while (performance.now() - start < 5000) {
      hidden ||= document.visibilityState !== 'visible';
      const before = performance.now();
      // Native contenteditable insertion enters ProseMirror through its DOM observer.
      // No engine API, document snapshot or forced React flush is added to typing.
      if (!document.execCommand('insertText', false, 'x')) throw new Error('Browser insertText failed');
      await Promise.resolve(); // include MutationObserver reconciliation in input sample
      inputs.push(performance.now() - before);
      keys++;
      await delay(Math.max(0, 50 - (performance.now() - before)));
    }
    await delay(100); // capture the final scheduled React commit/long-task delivery
    const end = performance.now();
    recording = false;
    observer.disconnect();
    cancelAnimationFrame(frameId);
    const selectors = performance.getEntriesByName('vdoc-selector').filter(entry => entry.startTime >= start && entry.startTime < end).map(entry => entry.duration);
    const result = {
      paragraphs, keys, measurementMs: end - start, hidden, userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency, at: new Date().toISOString(),
      renderMs: stats(commits.map(c => c.renderMs)), layoutEffectsMs: stats(commits.map(c => c.layoutEffectsMs)),
      renderAndEffectsMs: stats(commits.map(c => c.renderMs + c.layoutEffectsMs)),
      dispatchMs: stats(dispatches), inputThroughDomObserverMs: stats(inputs), frameIntervalsMs: stats(frames),
      selectorMs: stats(selectors),
      // Synchronous input includes forced layout. Selector callbacks run outside React.
      // This instrumented wall-time sum is NOT Chrome's total scripting time.
      observedScriptingMsPerKey: (inputs.reduce((a, b) => a + b, 0) + commits.reduce((sum, c) => sum + c.renderMs + c.layoutEffectsMs, 0) + selectors.reduce((a, b) => a + b, 0)) / keys,
      longTasks: longTasks.filter(task => task.startTime >= start && task.startTime < end), commits, dispatches, inputs,
    };
    output.textContent = JSON.stringify(result, null, 2);
    const response = await fetch('/profile-result', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(result) });
    if (!response.ok) throw new Error('Could not save profile result');
  } catch (error) { output.textContent = String(error); }
  finally {
    recording = false;
    observer.disconnect();
    cancelAnimationFrame(frameId);
    editor.view.setProps({ dispatchTransaction: originalDispatch });
    button.disabled = false;
  }
};
