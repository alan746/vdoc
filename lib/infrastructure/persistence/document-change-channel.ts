/** Cross-tab notice that a stored document was written, so an editor open on
 *  the same document in another tab can stop autosaving over it. */
export type DocumentChanges = {
  /** Call only after the write has committed. */
  announce(documentId: string): void;
  /** Calls `listener` when another tab announces `documentId`. Returns an unsubscribe. */
  watch(documentId: string, listener: () => void): () => void;
};

type Notice = { documentId: string; tabId: string };
const isNotice = (value: unknown): value is Notice =>
  !!value && typeof value === 'object' && typeof (value as Notice).documentId === 'string' && typeof (value as Notice).tabId === 'string';

const CHANNEL_NAME = 'vdoc.documents';
// Used only where BroadcastChannel is unavailable: writing this record fires a
// `storage` event in every other tab of the same origin.
const FALLBACK_KEY = 'vdoc.documents.changed';

export function createDocumentChanges(tabId?: string, channelName = CHANNEL_NAME): DocumentChanges {
  const fallbackKey = channelName === CHANNEL_NAME ? FALLBACK_KEY : `${channelName}.changed`;
  // This singleton is also imported by Worker SSR. Generate its per-tab identity
  // only when browser persistence starts using it, never during module loading.
  const identity = () => tabId ??= crypto.randomUUID();
  let channel: BroadcastChannel | null | undefined;
  const open = () => {
    if (channel === undefined) {
      channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(channelName) : null;
      // Node (tests) keeps the process alive while a channel is open; browsers have no unref.
      (channel as { unref?: () => void } | null)?.unref?.();
    }
    return channel;
  };
  return {
    announce(documentId) {
      const notice: Notice = { documentId, tabId: identity() };
      const target = open();
      if (target) { target.postMessage(notice); return; }
      try { localStorage.setItem(fallbackKey, JSON.stringify({ ...notice, at: Date.now() })); }
      catch { /* Storage is unavailable; there is no other way to reach other tabs. */ }
    },
    watch(documentId, listener) {
      const ownId = identity();
      const deliver = (data: unknown) => { if (isNotice(data) && data.documentId === documentId && data.tabId !== ownId) listener(); };
      const target = open();
      if (target) {
        const onMessage = (event: MessageEvent) => deliver(event.data);
        target.addEventListener('message', onMessage);
        return () => target.removeEventListener('message', onMessage);
      }
      const onStorage = (event: StorageEvent) => {
        if (event.key !== fallbackKey || !event.newValue) return;
        try { deliver(JSON.parse(event.newValue)); } catch { /* A malformed record is not a notice. */ }
      };
      window.addEventListener('storage', onStorage);
      return () => window.removeEventListener('storage', onStorage);
    },
  };
}

/** This tab's instance, shared by every persistence write and the document repository. */
export const documentChanges = createDocumentChanges();
