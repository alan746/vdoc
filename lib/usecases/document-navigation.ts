import type { Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

const lockKey = new PluginKey('documentNavigationLock');
const sessions = new WeakMap<Editor, DocumentNavigation>();
type Phase = 'idle' | 'reading' | 'committing';
export const PAUSED_AUTOSAVE_MESSAGE = 'Autosave is paused. Keep this document open and download a VDoc backup from the File menu before refreshing.';
export type SaveBlock = boolean | { current: boolean };
export function assertAutosaveActive(blocked: SaveBlock) {
  if (typeof blocked === 'boolean' ? blocked : blocked.current) throw new Error(PAUSED_AUTOSAVE_MESSAGE);
}

/** One navigation owner per editor, including events before React rerenders. */
class DocumentNavigation {
  private phase: Phase = 'idle';
  private listeners = new Set<() => void>();
  private compositionGuards = new Set<() => boolean>();
  private wasEditable = false;
  constructor(private editor: Editor) {}
  getSnapshot = () => this.phase;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  // Titles and other fields live outside ProseMirror. Recheck their current
  // composition state at the same boundary as body composition, including
  // after slow saves/file reads. Registration is scoped to the workspace.
  registerCompositionGuard = (guard: () => boolean) => {
    this.compositionGuards.add(guard);
    return () => { this.compositionGuards.delete(guard); };
  };
  isComposing = () => this.editor.view.composing || [...this.compositionGuards].some(guard => guard());
  private publish(phase: Phase) { this.phase = phase; this.listeners.forEach(listener => listener()); }
  acquire() {
    if (this.phase !== 'idle' || this.editor.isDestroyed) return false;
    this.publish('reading'); return true;
  }
  freeze() {
    if (this.phase !== 'reading') throw new Error('A document operation is already in progress.');
    if (this.isComposing()) throw new Error('Finish composing your text before opening another document.');
    this.wasEditable = this.editor.isEditable;
    // setEditable also makes the operation engine reject writes. The filter
    // covers direct Tiptap commands and delayed paste/resize transactions.
    this.editor.registerPlugin(new Plugin({ key: lockKey, filterTransaction: tr => !tr.docChanged }));
    this.editor.setEditable(false, false);
    this.publish('committing');
  }
  release() {
    if (this.phase === 'committing' && !this.editor.isDestroyed) {
      this.editor.unregisterPlugin(lockKey);
      this.editor.setEditable(this.wasEditable, false);
    }
    this.publish('idle');
  }
}

export function documentNavigation(editor: Editor) {
  let session = sessions.get(editor);
  if (!session) { session = new DocumentNavigation(editor); sessions.set(editor, session); }
  return session;
}
