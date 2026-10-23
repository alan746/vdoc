import type { Editor } from '@tiptap/core';
import type { DocumentWriter } from './ports';
import { documentNavigation } from './document-navigation';

const IDLE_SAVE_DELAY_MS = 450;
const MAX_SAVE_WAIT_MS = 2000;
export type InputComposition = { active: () => boolean; subscribe: (listener: () => void) => () => void };

type AutosaveOptions = {
  getTitle: () => string;
  blocked: { current: boolean };
  report: (status: string, warning?: string) => void;
  composition?: InputComposition;
};

/** Binds autosave to a persistence port; see lib/composition/autosave for the app wiring. */
export function createAutosave(writer: DocumentWriter) {
  return (editor: Editor, documentId: string, options: AutosaveOptions) => runAutosave(writer, editor, documentId, options);
}

function runAutosave(writer: DocumentWriter, editor: Editor, documentId: string, options: AutosaveOptions) {
  let disposed = false, writing = false, requested = false;
  let saved: { content: typeof editor.state.doc; title: string } | undefined;
  let guardingUnload = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pendingSince: number | undefined;
  const navigation = documentNavigation(editor);
  const clear = () => { clearTimeout(timer); timer = undefined; };
  const reset = () => { clear(); pendingSince = undefined; };
  const active = () => !disposed && !editor.isDestroyed;
  const composing = () => options.composition?.active() || editor.view.composing;
  const report = (status: string, warning?: string) => { if (active()) options.report(status, warning); };
  const schedule = () => {
    updateUnloadGuard();
    clear();
    if (!active()) { reset(); return; }
    if (options.blocked.current) { reset(); report('Autosave paused'); return; }
    report('Saving…');
    if (navigation.getSnapshot() === 'committing') { reset(); requested = true; return; }
    // New input may reset the idle debounce, never the oldest pending deadline.
    // Keep that deadline while a write is in flight so its successor is not
    // postponed again when storage is slow.
    pendingSince ??= performance.now();
    const remaining = Math.max(0, MAX_SAVE_WAIT_MS - (performance.now() - pendingSince));
    timer = setTimeout(() => { void flush(); }, Math.min(IDLE_SAVE_DELAY_MS, remaining));
  };
  const flush = async () => {
    clear();
    if (!active()) { reset(); return; }
    if (options.blocked.current) { reset(); report('Autosave paused'); return; }
    if (writing || navigation.getSnapshot() === 'committing') { requested = true; return; }
    writing = true; requested = false;
    updateUnloadGuard();
    pendingSince = undefined;
    const content = editor.state.doc, title = options.getTitle();
    const matchesCurrent = () => title === options.getTitle() && content.eq(editor.state.doc);
    let succeeded = false;
    report('Saving…');
    try {
      await writer.save(title, content.toJSON(), documentId);
      succeeded = true;
      saved = { content, title };
      if (!active()) return;
      if (options.blocked.current) { report('Autosave paused'); return; }
      // A completed older write is not proof that the current draft is saved.
      if (navigation.getSnapshot() === 'idle' && matchesCurrent()) {
        if (composing()) report('Finishing input…');
        else report('Saved locally', '');
      }
    } catch (error) {
      if (!active()) return;
      if (options.blocked.current) { report('Autosave paused'); return; }
      if (navigation.getSnapshot() !== 'committing') report('Save failed. Download a backup.',
        `${error instanceof Error || error instanceof DOMException ? error.message : 'Browser storage is unavailable.'} Your changes have not been saved. Download a backup from the File menu.`);
    } finally {
      writing = false;
      if (active() && !options.blocked.current && ((requested && !succeeded) || !matchesCurrent())) {
        // An expired deadline must not create an immediate failure/retry loop.
        if (!succeeded) reset();
        requested = false; schedule();
      } else { reset(); requested = false; }
      updateUnloadGuard();
    }
  };
  const hasUnsavedChanges = () => options.blocked.current || composing() || navigation.getSnapshot() !== 'idle' || writing || !saved ||
    saved.title !== options.getTitle() || !saved.content.eq(editor.state.doc);
  const beforeUnload = (event: BeforeUnloadEvent) => {
    if (!active() || !hasUnsavedChanges()) return;
    // pagehide cannot wait for IndexedDB. Ask the browser to keep the draft
    // open; choosing to leave still cannot guarantee an async write completes.
    event.preventDefault(); event.returnValue = '';
    void flush();
  };
  const updateUnloadGuard = () => {
    const needed = active() && hasUnsavedChanges();
    if (needed === guardingUnload) return;
    guardingUnload = needed;
    if (needed) window.addEventListener('beforeunload', beforeUnload);
    else window.removeEventListener('beforeunload', beforeUnload);
  };
  const visibility = () => { if (document.visibilityState === 'hidden') void flush(); };
  const pagehide = () => { void flush(); };
  const conflict = () => {
    options.blocked.current = true; reset(); requested = false; updateUnloadGuard();
    report('Autosave paused', 'This document was updated in another tab. Download a backup of your current changes before refreshing.');
  };
  const unsubscribeComposition = options.composition?.subscribe(() => {
    if (!active()) return;
    updateUnloadGuard();
    if (options.blocked.current) { report('Autosave paused'); return; }
    if (composing()) report('Finishing input…');
    else schedule(); // Candidate cancellation may produce no editor update.
  });
  let previousPhase = navigation.getSnapshot();
  const unsubscribe = navigation.subscribe(() => {
    const phase = navigation.getSnapshot();
    if (phase === 'committing') { reset(); requested = true; }
    else if (phase === 'idle' && previousPhase !== 'idle') {
      // File-menu saves and version checkpoints also write while in the reading
      // phase. They can replace the snapshot remembered by this controller,
      // even if the user has undone back to its previous saved content.
      saved = undefined;
      requested = false;
      // Give a completed navigation time to unmount this editor. If opening
      // failed, resume saving the still-open draft after the normal debounce.
      schedule();
    }
    if (phase === 'reading') report(options.blocked.current ? 'Autosave paused' : 'Saving…');
    previousPhase = phase;
    updateUnloadGuard();
  });
  editor.on('update', schedule);
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('pagehide', pagehide);
  const unwatchExternalChanges = writer.watchExternalChanges(documentId, conflict);
  schedule();
  return { schedule, flush, dispose: () => {
    disposed = true; updateUnloadGuard(); reset(); unsubscribe(); unsubscribeComposition?.(); editor.off('update', schedule);
    document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('pagehide', pagehide);
    unwatchExternalChanges();
  } };
}
