import { getSchema, type JSONContent } from '@tiptap/core';
import { createExtensions } from '../../editor/extensions';
import { editorBundle } from '../../editor/feature-list';
import { parseDocumentEnvelope, validateDocumentTree } from '../../domain/rules/document-validation';
import { CURRENT_DOCUMENT_VERSION } from '../../domain/rules/document-migrations';
export const STORAGE_KEY = 'vdoc.document.v1';
const INDEX_KEY = 'vdoc.library.v1';
const archiveKey = (id: string) => `vdoc.archive.${id}`;
import type { DocumentDraft, DocumentSummary, SavedDocument } from '../../domain/entities/document';
let schema: ReturnType<typeof getSchema> | undefined;
// Native backups follow the same size policy as saved documents. Conversion
// callers can supply their own bound; structural validation always runs.
export function parseDocument(raw: string, maxLength = Infinity): DocumentDraft {
  const value = parseDocumentEnvelope(raw, maxLength);
  validateDocumentTree(value.content, editorBundle.validation);
  schema ??= getSchema(createExtensions());
  const node = schema.nodeFromJSON(value.content); node.check();
  editorBundle.validateDocument(node);
  return { version: CURRENT_DOCUMENT_VERSION, ...(typeof value.id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value.id) ? { id: value.id } : {}), title: value.title, content: node.toJSON(), savedAt: typeof value.savedAt === 'string' ? value.savedAt : new Date().toISOString() };
}
export function readSavedDocument(): { data: DocumentDraft | null; error?: string } {
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
    if (existing.version !== CURRENT_DOCUMENT_VERSION) throw new Error('Unsupported stored document.');
    id = existing.id;
    if (existing.id && existing.title === title && JSON.stringify(existing.content) === JSON.stringify(content)) return existing;
  }
  const data: SavedDocument = { version: CURRENT_DOCUMENT_VERSION, id: id || crypto.randomUUID(), title, content, savedAt: new Date().toISOString() };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); return data;
}
export function listDocuments(): DocumentSummary[] {
  const raw = localStorage.getItem(INDEX_KEY);
  if (!raw) return [];
  const list = JSON.parse(raw);
  if (!Array.isArray(list)) throw new Error('The local document index could not be read.');
  return list;
}
export function archiveDocument(document: DocumentDraft): SavedDocument {
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
export function activateDocument(next: DocumentDraft) {
  const current = readSavedDocument();
  if (current.error) {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) localStorage.setItem(`vdoc.recovery.${Date.now()}`, raw);
  } else if (current.data) archiveDocument(current.data);
  const data = archiveDocument(next);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  return data;
}
