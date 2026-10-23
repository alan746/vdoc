import type { DocumentChanges } from '../../lib/infrastructure/persistence/document-change-channel';

// Stand-in for lib/infrastructure/persistence/document-change-channel, for
// tests that use fake timers: BroadcastChannel delivery is asynchronous, so the
// real channel is covered by its own test with real timers instead.
const listeners = new Map<string, Set<() => void>>();

export const documentChanges: DocumentChanges = {
  announce: () => {},
  watch(documentId, listener) {
    const set = listeners.get(documentId) ?? new Set();
    set.add(listener); listeners.set(documentId, set);
    return () => { set.delete(listener); };
  },
};
export const createDocumentChanges = () => documentChanges;

/** Simulates another tab announcing that it wrote `documentId`. */
export function changeInAnotherTab(documentId: string) {
  for (const listener of [...(listeners.get(documentId) ?? [])]) listener();
}
