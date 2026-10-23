import type { JSONContent } from '@tiptap/core';
import { documentTitle, type DocumentDraft, type DocumentVersionSummary, type LibraryItem, type SavedDocument } from '../../domain/entities/document';
import type { DocumentRepository, LibraryRepository, VersionRepository } from '../../usecases/ports';
import { parseDocument } from '../persistence/document-codec';
import { createDocumentChanges } from '../persistence/document-change-channel';
import type { CloudItem } from '../cloud-library/store';
import { CloudCache, type CachedItem } from './cache';

export type SyncState = { status: 'idle' | 'syncing' | 'offline' | 'account-changed'; pending: number; conflicts: string[]; message: string };
class CloudRequestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
const saved = (record: CachedItem): SavedDocument => {
  if (record.pending) return record.pending.document;
  const item = record.item;
  if (!item.content || item.kind !== 'document' || item.deletedAt || item.trashedAt) throw new Error('This document is unavailable. Connect to refresh your library.');
  return { ...parseDocument(JSON.stringify({ version: item.formatVersion, title: item.title, content: item.content })), id: item.id, savedAt: item.updatedAt };
};
const putBody = (item: CloudItem, document: SavedDocument, revision: number) => ({ action: 'put', id: item.id, expectedRevision: revision,
  kind: item.kind, title: document.title, parentId: item.parentId, starred: item.starred, content: document.content, formatVersion: document.version });
// PostgreSQL jsonb may reorder object keys; compare normalized document trees.
const normalized = (item: CloudItem) => parseDocument(JSON.stringify({ version: item.formatVersion, title: item.title, content: item.content })).content;
const equivalent = (remote: CloudItem, local: CachedItem) => Boolean(local.pending && !remote.deletedAt && !remote.trashedAt &&
  remote.title === local.pending.document.title && remote.parentId === local.item.parentId && remote.starred === local.item.starred &&
  JSON.stringify(normalized(remote)) === JSON.stringify(local.pending.document.content));

export class CloudRepositories {
  readonly cache: CloudCache;
  readonly documents: DocumentRepository;
  readonly library: LibraryRepository;
  readonly versions: VersionRepository;
  private seen = new Map<string, number>();
  private listed = new Map<string, number>();
  private changes;
  private watching = new Map<string, Set<() => void>>();
  private listeners = new Set<() => void>();
  private syncing?: Promise<void>;
  private stopped = false;
  private blocked = false;
  private state: SyncState = { status: 'idle', pending: 0, conflicts: [], message: '' };
  constructor(readonly owner: string, private fetcher: typeof fetch = fetch, factory?: IDBFactory) {
    this.cache = new CloudCache(owner, factory);
    this.changes = createDocumentChanges(undefined, `vdoc.cloud.${owner}`);
    this.documents = {
      select: id => this.select(id),
      readActive: async requested => { try { const id = requested ?? await this.cache.active(); return { data: id ? await this.select(id) : null }; }
        catch (error) { return { data: null, error: error instanceof Error ? error.message : 'Cloud document could not be opened.' }; } },
      save: (title, content, id) => this.save(title, content, id),
      activate: draft => this.createDocument(draft, null),
      watchExternalChanges: (id, listener) => {
        const listeners = this.watching.get(id) ?? new Set(); listeners.add(listener); this.watching.set(id, listeners);
        const unwatch = this.changes.watch(id, listener);
        return () => { unwatch(); listeners.delete(listener); if (!listeners.size) this.watching.delete(id); };
      },
    };
    this.library = {
      list: () => this.list(),
      createDocument: (draft, parent) => this.createDocument(draft, parent),
      createFolder: async (title, parentId) => {
        const item = await this.command({ action: 'put', id: crypto.randomUUID(), expectedRevision: 0, kind: 'folder', title: documentTitle(title), parentId, starred: false, content: null, formatVersion: null });
        return item.id;
      },
      update: async (id, patch) => {
        await this.requireSynced();
        const record = await this.load(id);
        const item = record.item;
        if (patch.expectedTrashGroup && item.trashGroup !== patch.expectedTrashGroup) throw new Error('This item changed. Refresh the library.');
        const expectedRevision = this.listed.get(id) ?? item.revision;
        let updated: CloudItem;
        if (patch.trash !== undefined) updated = await this.command({ action: patch.trash ? 'trash' : 'restore', id, expectedRevision });
        else updated = await this.command({ action: 'put', id, expectedRevision, kind: item.kind, title: patch.title === undefined ? item.title : documentTitle(patch.title),
          parentId: patch.parentId === undefined ? item.parentId : patch.parentId, starred: patch.starred ?? item.starred, content: item.content, formatVersion: item.formatVersion });
        return this.metadata(updated);
      },
      copy: async id => { const current = await this.select(id); return this.createDocument({ ...current, title: `Copy of ${current.title}`.slice(0, 500) }, (await this.cache.get(id))!.item.parentId); },
      deleteTrashed: async (id, expected) => {
        await this.requireSynced(); const record = await this.load(id);
        if (record.item.trashedAt !== expected.at || (record.item.trashGroup ?? undefined) !== expected.group) throw new Error('This item changed since you opened Trash. Refresh before deleting.');
        await this.command({ action: 'delete', id, expectedRevision: this.listed.get(id) ?? record.item.revision });
      },
    };
    this.versions = {
      list: id => this.listVersions(id),
      save: async (document, label) => {
        await this.requireSynced(); const record = await this.load(document.id); const versionId = crypto.randomUUID();
        await this.command({ action: 'checkpoint', id: document.id, expectedRevision: record.item.revision, versionId, label: label.trim() || 'Saved version' });
        const version = (await this.listVersions(document.id)).find(v => v.key === versionId);
        if (!version) throw new Error('Checkpoint saved, but the list could not be refreshed. Retry loading.');
        return version;
      },
      restore: async (key, current) => {
        await this.requireSynced(); const record = await this.load(current.id);
        const item = await this.command({ action: 'restoreVersion', id: current.id, expectedRevision: record.item.revision, versionId: key });
        const latest = (await this.cache.get(item.id))!; this.seen.set(item.id, latest.sequence); return saved(latest);
      },
    };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private async publish(status = this.state.status, message = this.state.message) {
    const records = await this.cache.all();
    this.state = { status, message, pending: records.filter(r => r.pending).length, conflicts: records.filter(r => r.pending?.conflict).map(r => r.item.id) };
    this.listeners.forEach(listener => listener());
  }
  private async json<T>(path: string, body?: unknown): Promise<T> {
    if (this.blocked) throw new CloudRequestError(409, 'ACCOUNT_CHANGED', 'Sign in to the original account and reopen this workspace.');
    const response = await this.fetcher(path, { method: body === undefined ? 'GET' : 'POST', cache: 'no-store',
      headers: { 'x-vdoc-account': this.owner, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
    if (!response.ok) {
      const error = await response.json().catch(() => ({})) as { error?: { code?: string; message?: string } };
      if (response.status === 401 || error.error?.code === 'ACCOUNT_CHANGED') {
        this.blocked = true; await this.publish('account-changed', 'Your login changed or expired. Local edits are kept for this account.');
      }
      throw new CloudRequestError(response.status, error.error?.code || 'REQUEST_FAILED', error.error?.message || 'Cloud storage is temporarily unavailable.');
    }
    return response.json() as Promise<T>;
  }
  private async accept(item: CloudItem, notify = false) {
    let changed = false;
    const record = await this.cache.mutate(item.id, current => {
      if (current && current.item.revision > item.revision) return current;
      if (current?.pending) {
        if (item.revision !== current.pending.baseRevision) return { ...current, pending: { ...current.pending, conflict: true } };
        return current;
      }
      changed = Boolean(current && current.item.revision !== item.revision);
      return { item, sequence: (current?.sequence ?? 0) + (changed ? 1 : 0) };
    });
    if (changed && notify) { this.watching.get(item.id)?.forEach(listener => listener()); this.changes.announce(item.id); }
    return record;
  }
  private async load(id: string): Promise<CachedItem> {
    const record = await this.cache.get(id);
    if (record?.pending || (record?.item.content && !record.item.deletedAt) || record?.item.kind === 'folder') return record;
    const { item } = await this.json<{ item: CloudItem }>(`/api/library/${encodeURIComponent(id)}`);
    return this.accept(item);
  }
  private async select(id: string) {
    let record = await this.cache.get(id);
    try {
      if (!record?.pending) { const { item } = await this.json<{ item: CloudItem }>(`/api/library/${encodeURIComponent(id)}`); record = await this.accept(item); }
    } catch (error) {
      if (error instanceof CloudRequestError && error.status < 500) throw error;
      if (!record) throw new Error('This document is not cached. Connect to open it.');
      await this.publish('offline', 'Using this account’s cached documents. Reconnect to sync.');
    }
    if (!record) throw new Error('Document unavailable.');
    const document = saved(record); this.seen.set(id, record.sequence); await this.cache.active(id); return document;
  }
  private async save(title: string, content: JSONContent, id: string) {
    const document = { ...parseDocument(JSON.stringify({ version: 1, title: documentTitle(title), content })), id, savedAt: new Date().toISOString() };
    const expected = this.seen.get(id);
    const record = await this.cache.mutate(id, current => {
      if (!current || expected === undefined || current.sequence !== expected) throw new Error('Another tab changed this document. Export your edits before reloading.');
      if (current.item.deletedAt || current.item.trashedAt) throw new Error('This document is in Trash. Export your edits before reloading.');
      const previous = saved(current);
      if (previous.title === document.title && JSON.stringify(previous.content) === JSON.stringify(document.content)) return current;
      return { ...current, sequence: current.sequence + 1, pending: { document, baseRevision: current.pending?.baseRevision ?? current.item.revision, ...(current.pending?.conflict ? { conflict: true } : {}) } };
    });
    this.seen.set(id, record.sequence); if (record.sequence !== expected) this.changes.announce(id); await this.publish();
    void this.sync().catch(() => undefined); return saved(record);
  }
  private async acknowledge(sent: CachedItem, item: CloudItem) {
    await this.cache.mutate(item.id, current => {
      if (!current) throw new Error('Missing cloud cache.');
      if (!current.pending) return current;
      if (current.sequence === sent.sequence) return { item, sequence: current.sequence };
      return { ...current, item, pending: { document: current.pending.document, baseRevision: item.revision } };
    });
  }
  private async syncRecord(record: CachedItem) {
    if (!record.pending || record.pending.conflict) return;
    try {
      const { item } = await this.json<{ item: CloudItem }>('/api/library', putBody(record.item, record.pending.document, record.pending.baseRevision));
      await this.acknowledge(record, item);
    } catch (error) {
      if (error instanceof CloudRequestError && ['REVISION_CONFLICT', 'NOT_FOUND', 'ITEM_TRASHED'].includes(error.code)) {
        // A committed response may have been lost. Reconcile before declaring a conflict.
        let remote: CloudItem | undefined;
        try { remote = (await this.json<{ item: CloudItem }>(`/api/library/${record.item.id}`)).item; }
        catch (readError) { if (!(readError instanceof CloudRequestError && readError.status === 404)) throw readError; }
        if (remote && equivalent(remote, record)) await this.acknowledge(record, remote);
        else await this.cache.mutate(record.item.id, current => {
          if (!current?.pending) return current!;
          return { ...current, pending: { ...current.pending, conflict: true } };
        });
      } else throw error;
    }
  }
  sync = async (): Promise<void> => {
    if (this.stopped || this.blocked) return;
    if (this.syncing) return this.syncing;
    const work = async () => {
      try {
        await this.publish('syncing', '');
        for (const record of await this.cache.all()) await this.syncRecord(record);
        await this.publish('idle', '');
      } catch (error) {
        if (!this.blocked) await this.publish('offline', error instanceof CloudRequestError ? error.message : 'Offline or cloud unavailable. Edits are saved in this account’s local cache.');
      }
    };
    this.syncing = Promise.resolve(typeof navigator !== 'undefined' && navigator.locks ? navigator.locks.request(`vdoc-sync:${this.owner}`, work) : work()).then(() => undefined).finally(() => { this.syncing = undefined; });
    return this.syncing;
  };
  private async requireSynced() {
    await this.sync();
    if ((await this.cache.all()).some(r => r.pending)) throw new Error('Sync or resolve pending edits before changing folders, Trash or history.');
    if (this.blocked) throw new Error('Sign in again before changing cloud documents.');
  }
  private metadata(item: CloudItem) { return { id: item.id, parentId: item.parentId, starred: item.starred, ...(item.trashedAt ? { trash: { at: item.trashedAt, ...(item.trashGroup ? { group: item.trashGroup } : {}) } } : {}) }; }
  private async list(): Promise<LibraryItem[]> {
    await this.sync();
    try {
      let cursor: string | null = null;
      do {
        const page: { items: Omit<CloudItem, 'content'>[]; nextCursor: string | null } = await this.json(`/api/library${cursor ? `?after=${encodeURIComponent(cursor)}` : ''}`);
        for (const entry of page.items) {
          const cached = await this.cache.get(entry.id);
          if (cached && cached.item.revision === entry.revision) continue;
          let item: CloudItem = { ...entry, content: null };
          if (cached?.item.content && !cached.pending && !entry.deletedAt) item = (await this.json<{ item: CloudItem }>(`/api/library/${entry.id}`)).item;
          await this.accept(item, true);
        }
        cursor = page.nextCursor;
      } while (cursor);
      await this.publish('idle', '');
    } catch (error) {
      if (this.blocked || !(await this.cache.all()).length) throw error;
      await this.publish('offline', 'Using cached files. Reconnect to refresh the cloud library.');
    }
    return (await this.cache.all()).filter(r => !r.item.deletedAt).map(record => {
      const item = record.item; this.listed.set(item.id, item.revision);
      return { ...this.metadata(item), kind: item.kind, title: record.pending?.document.title ?? item.title, savedAt: record.pending?.document.savedAt ?? item.updatedAt };
    });
  }
  private async command(body: unknown) {
    const { item } = await this.json<{ item: CloudItem }>('/api/library', body);
    const record = await this.accept(item); this.seen.set(item.id, record.sequence); this.changes.announce(item.id); return item;
  }
  private async createDocument(draft: DocumentDraft, parentId: string | null) {
    const document = parseDocument(JSON.stringify(draft));
    const item = await this.command({ action: 'put', id: crypto.randomUUID(), expectedRevision: 0, kind: 'document', title: documentTitle(document.title), parentId, starred: false, content: document.content, formatVersion: document.version });
    await this.cache.active(item.id); return saved((await this.cache.get(item.id))!);
  }
  private async listVersions(id: string): Promise<DocumentVersionSummary[]> {
    const { versions } = await this.json<{ versions: { id: string; label: string; title: string; documentRevision: number; createdAt: string }[] }>(`/api/library/${encodeURIComponent(id)}/versions`);
    return versions.map(v => ({ key: v.id, documentId: id, label: v.label, createdAt: v.createdAt, sequence: v.documentRevision }));
  }
  /** Export remains available even if the remote document was deleted. */
  async exportPending(id: string) { const record = await this.cache.get(id); if (!record?.pending) throw new Error('No pending local copy.'); return record.pending.document; }
  async useCloudCopy(id: string) {
    const before = await this.cache.get(id);
    if (!before?.pending) throw new Error('No pending local copy.');
    let item: CloudItem;
    try { item = (await this.json<{ item: CloudItem }>(`/api/library/${encodeURIComponent(id)}`)).item; }
    catch (error) {
      if (!(error instanceof CloudRequestError && error.status === 404)) throw error;
      const current = (await this.cache.get(id))!;
      item = { ...current.item, content: null, title: 'Deleted document', deletedAt: new Date().toISOString() };
    }
    await this.cache.mutate(id, current => {
      if (!current || current.sequence !== before.sequence) throw new Error('Another tab edited this copy. Download it again before resolving.');
      return { item, sequence: current.sequence + 1 };
    });
    this.changes.announce(id); await this.publish();
  }
  start() {
    let refreshing = false;
    const refresh = () => { if (refreshing || this.stopped) return; refreshing = true; void this.sync().then(async () => {
      if (this.stopped || this.blocked) return;
      for (const id of this.watching.keys()) {
        try {
          const { item } = await this.json<{ item: CloudItem }>(`/api/library/${id}`);
          if (this.stopped) return;
          await this.accept(item, true);
        } catch (error) {
          if (error instanceof CloudRequestError && error.status === 404) this.watching.get(id)?.forEach(listener => listener());
        }
      }
      await this.publish();
    }).catch(() => undefined).finally(() => { refreshing = false; }); };
    const timer = setInterval(refresh, 15000);
    window.addEventListener('online', refresh); window.addEventListener('focus', refresh); refresh();
    return () => { this.stopped = true; clearInterval(timer); window.removeEventListener('online', refresh); window.removeEventListener('focus', refresh); };
  }
}
