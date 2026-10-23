import { getSchema, type JSONContent } from '@tiptap/core';
import { TableMap } from '@tiptap/pm/tables';
import { createExtensions } from '../../editor/extensions';
import { completePinnedBoundary } from '../../editor/table/table-headers';
import { parseDocumentEnvelope, validateDocumentTree } from '../../domain/rules/document-validation';
export const STORAGE_KEY = 'vdoc.document.v1';
const INDEX_KEY = 'vdoc.library.v1';
const archiveKey = (id: string) => `vdoc.archive.${id}`;
import type { SavedDocument, LibraryEntry } from '../../domain/entities/document';
let schema: ReturnType<typeof getSchema> | undefined;
// Native backups follow the same size policy as saved documents. Conversion
// callers can supply their own bound; structural validation always runs.
export function parseDocument(raw: string, maxLength = Infinity): SavedDocument {
  const value = parseDocumentEnvelope(raw, maxLength);
  validateDocumentTree(value.content);
  schema ??= getSchema(createExtensions());
  const node = schema.nodeFromJSON(value.content); node.check();
  node.descendants(table => {
    if (table.type.name !== 'table') return;
    // Node.check validates cell attributes/content, not the occupied grid. Do
    // not let the editor silently repair a damaged backup or saved version.
    // Legacy partial column widths are layout hints, not missing/overlapping cells.
    if (TableMap.get(table).problems?.some(problem => problem.type !== 'colwidth mismatch')) throw new Error('The document contains an invalid table structure. Cells are missing, overlapping, or extend beyond the table.');
    if (table.attrs.pinnedRows != null && completePinnedBoundary(table, table.attrs.pinnedRows) !== table.attrs.pinnedRows) throw new Error('The pinned header boundary splits a merged cell.');
  });
  return { version: 1, ...(typeof value.id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value.id) ? { id: value.id } : {}), title: value.title, content: node.toJSON(), savedAt: typeof value.savedAt === 'string' ? value.savedAt : new Date().toISOString() };
}
export function readSavedDocument(): { data: SavedDocument | null; error?: string } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return { data: raw ? parseDocument(raw) : null };
  } catch { return { data: null, error: 'The local document could not be opened. Autosave is paused to preserve the original data. Export the original backup or open another document.' }; }
}
export function saveDocument(title: string, content: JSONContent): SavedDocument {
  const previous = localStorage.getItem(STORAGE_KEY);
  let id: string | undefined;
  if (previous) {
    const existing = JSON.parse(previous) as SavedDocument;
    if (existing.version !== 1) throw new Error('Unsupported stored document.');
    id = existing.id;
    if (existing.id && existing.title === title && JSON.stringify(existing.content) === JSON.stringify(content)) return existing;
  }
  const data: SavedDocument = { version: 1, id: id || crypto.randomUUID(), title, content, savedAt: new Date().toISOString() };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); return data;
}
export function listDocuments(): LibraryEntry[] {
  const raw = localStorage.getItem(INDEX_KEY);
  if (!raw) return [];
  const list = JSON.parse(raw);
  if (!Array.isArray(list)) throw new Error('The local document index could not be read.');
  return list;
}
export function archiveDocument(document: SavedDocument) {
  const data = { ...document, id: document.id || crypto.randomUUID() };
  const list = listDocuments();
  localStorage.setItem(archiveKey(data.id), JSON.stringify(data));
  localStorage.setItem(INDEX_KEY, JSON.stringify([{ id: data.id, title: data.title, savedAt: data.savedAt }, ...list.filter(d => d.id !== data.id)]));
  return data;
}
export function openArchivedDocument(id: string) {
  const raw = localStorage.getItem(archiveKey(id));
  if (!raw) throw new Error('This document is no longer on this device.');
  return parseDocument(raw);
}
export function activateDocument(next: SavedDocument) {
  const current = readSavedDocument();
  if (current.error) {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) localStorage.setItem(`vdoc.recovery.${Date.now()}`, raw);
  } else if (current.data) archiveDocument(current.data);
  const data = archiveDocument(next);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  return data;
}
