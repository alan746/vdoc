import type { DocumentVersion, LibraryItem, LibraryMetadata, SavedDocument, Trash } from '../../lib/domain/entities/document';
import type { DocumentRepository, LibraryRepository, VersionRepository } from '../../lib/usecases/ports';

/** Process-local implementation of the persistence ports, used to prove use cases and contracts are storage-agnostic. */
export function createInMemoryRepositories() {
  const docs = new Map<string, SavedDocument>();
  const folders = new Map<string, { id: string; title: string; savedAt: string }>();
  const meta = new Map<string, LibraryMetadata>();
  const history: DocumentVersion[] = [];
  let active: string | null = null;
  let sequence = 0;
  const now = () => new Date().toISOString();
  const clone = <T>(value: T): T => structuredClone(value);
  const items = (): LibraryItem[] => [
    ...[...docs.values()].map(d => ({ id: d.id, title: d.title, savedAt: d.savedAt, kind: 'document' as const })),
    ...[...folders.values()].map(f => ({ ...f, kind: 'folder' as const })),
  ].map(item => ({ ...item, parentId: null, starred: false, ...meta.get(item.id) }));
  const writable = (id: string) => {
    if (!docs.has(id)) throw new Error('The local document no longer exists. Download a backup of your changes.');
    if (meta.get(id)?.trash) throw new Error('This document is in Trash. Restore it from your library before saving, or download a backup of your changes.');
  };
  const descendants = (root: string) => {
    const ids = new Set([root]); let changed = true;
    while (changed) { changed = false; for (const entry of items()) if (entry.parentId && ids.has(entry.parentId) && !ids.has(entry.id)) { ids.add(entry.id); changed = true; } }
    return ids;
  };
  const metadataFor = (id: string): LibraryMetadata => ({ id, parentId: null, starred: false, ...meta.get(id) });

  const documents: DocumentRepository = {
    changeKey: 'vdoc.memory.document',
    async select(id) {
      if (!docs.has(id)) throw new Error('This document is not available in this browser. Open a document from your library or import a backup.');
      if (meta.get(id)?.trash) throw new Error('This document is in Trash. Restore it from your library before opening it.');
      active = id; return clone(docs.get(id)!);
    },
    async readActive(requestedId) {
      const id = requestedId ?? active;
      return { data: id && docs.has(id) ? clone(docs.get(id)!) : null };
    },
    async save(title, content, id) {
      writable(id);
      const next = { ...docs.get(id)!, title, content: clone(content), savedAt: now() };
      docs.set(id, next); return clone(next);
    },
    async activate(document) {
      const data = { ...clone(document), id: document.id || crypto.randomUUID() };
      docs.set(data.id, data); active = data.id; return clone(data);
    },
  };

  const library: LibraryRepository = {
    async list() { return clone(items()); },
    async createDocument(document, parentId) {
      const data = { ...clone(document), id: crypto.randomUUID(), savedAt: now() };
      docs.set(data.id, data); meta.set(data.id, { id: data.id, parentId, starred: false }); active = data.id;
      return clone(data);
    },
    async createFolder(title, parentId) {
      const id = crypto.randomUUID();
      folders.set(id, { id, title: title.trim(), savedAt: now() }); meta.set(id, { id, parentId, starred: false });
      return id;
    },
    async update(id, patch) {
      const item = items().find(entry => entry.id === id);
      if (!item) throw new Error('This item no longer exists.');
      if (patch.expectedTrashGroup !== undefined && (!item.trash || item.trash.group !== patch.expectedTrashGroup)) throw new Error('This item changed after it was moved to Trash. Open Trash to review its current state.');
      const next = metadataFor(id);
      if (patch.title !== undefined) {
        if (item.kind === 'folder') folders.set(id, { id, title: patch.title.trim(), savedAt: now() });
        else docs.set(id, { ...docs.get(id)!, title: patch.title.trim(), savedAt: now() });
      }
      if (patch.parentId !== undefined) {
        for (let cursor = patch.parentId; cursor; cursor = metadataFor(cursor).parentId)
          if (cursor === id) throw new Error('A folder cannot be moved into itself or one of its subfolders.');
        next.parentId = patch.parentId;
      }
      if (patch.starred !== undefined) next.starred = patch.starred;
      if (patch.trash === true && !item.trash) {
        const trash: Trash = { at: now(), group: crypto.randomUUID() };
        for (const entry of items()) if (descendants(id).has(entry.id) && !entry.trash) meta.set(entry.id, { ...metadataFor(entry.id), trash });
        next.trash = trash;
      } else if (patch.trash === false && item.trash) {
        for (const entry of items()) if (entry.id !== id && descendants(id).has(entry.id) && entry.trash?.group === item.trash.group) {
          const restored = metadataFor(entry.id); delete restored.trash; meta.set(entry.id, restored);
        }
        delete next.trash;
      }
      meta.set(id, next); return clone(next);
    },
    async copy(id) {
      const original = docs.get(id);
      if (!original || meta.get(id)?.trash) throw new Error('Restore the document before copying it.');
      const copy = { ...clone(original), id: crypto.randomUUID(), title: `Copy of ${original.title}`, savedAt: now() };
      docs.set(copy.id, copy); meta.set(copy.id, { id: copy.id, parentId: metadataFor(id).parentId, starred: false });
      return clone(copy);
    },
    async deleteTrashed(id, expected) {
      const current = meta.get(id);
      if (!docs.has(id)) throw new Error('This document no longer exists.');
      if (!current?.trash || current.trash.at !== expected.at || current.trash.group !== expected.group) throw new Error('This document changed since you opened Trash. Cancel and review it again before deleting.');
      docs.delete(id); meta.delete(id);
      for (let i = history.length - 1; i >= 0; i--) if (history[i].documentId === id) history.splice(i, 1);
      if (active === id) active = null;
    },
  };

  const newestFirst = (a: DocumentVersion, b: DocumentVersion) => b.sequence - a.sequence;
  const versions: VersionRepository = {
    async save(document: SavedDocument, label) {
      writable(document.id);
      const version = { key: crypto.randomUUID(), documentId: document.id, label: label.trim() || 'Saved version', createdAt: now(), sequence: ++sequence, snapshot: { title: document.title, content: clone(document.content) } };
      history.push(version); return clone(version);
    },
    async list(documentId) { return clone(history.filter(v => v.documentId === documentId).sort(newestFirst)); },
    async restore(key, current) {
      const version = history.find(v => v.key === key);
      if (!version || version.documentId !== current.id) throw new Error('This version is not available for the current document.');
      writable(current.id);
      history.push({ key: crypto.randomUUID(), documentId: current.id, label: 'Before restoring a version', createdAt: now(), sequence: ++sequence, snapshot: { title: current.title, content: clone(current.content) } });
      const restored = { ...clone(current), ...clone(version.snapshot), savedAt: now() };
      docs.set(current.id, restored); active = current.id;
      return clone(restored);
    },
  };
  return { documents, library, versions };
}
