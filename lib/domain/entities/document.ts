import type { JSONContent } from '@tiptap/core';
import { CURRENT_DOCUMENT_VERSION } from '../rules/document-migrations';
// Core VDoc entities. Persistence, import and UI layers share these shapes.
/** A persisted document. `version` is the backup/storage format version, not a history checkpoint. */
export type SavedDocument = { version: typeof CURRENT_DOCUMENT_VERSION; id: string; title: string; content: JSONContent; savedAt: string };
/** A document that has not been stored yet (new, imported or parsed from a backup), so it may lack an id. */
export type DocumentDraft = Omit<SavedDocument, 'id'> & { id?: string };
/** Library listing row for a document or folder. */
export type DocumentSummary = { id: string; title: string; savedAt: string };
/** When and in which operation an item was moved to Trash; restoring a folder restores only children of the same group. */
export type Trash = { at: string; group?: string };
/** Organisation state of a library item (folder placement, star, trash). */
export type LibraryMetadata = { id: string; parentId: string | null; starred: boolean; trash?: Trash };
export type LibraryItem = DocumentSummary & LibraryMetadata & { kind: 'document' | 'folder' };
/** Content captured by a version checkpoint. Identity comes from `DocumentVersion.documentId`. */
export type VersionSnapshot = { title: string; content: JSONContent };
export type DocumentVersion = { key: string; documentId: string; label: string; createdAt: string; sequence: number; snapshot: VersionSnapshot };

/** Title used whenever a document has no name. */
export const UNTITLED_DOCUMENT = 'Untitled document';
/** The title to store: trimmed, or the default when blank. */
export const documentTitle = (title: string) => title.trim() || UNTITLED_DOCUMENT;
/** A new, empty, untitled document. */
export const blankDocument = (): DocumentDraft => ({ version: CURRENT_DOCUMENT_VERSION, title: UNTITLED_DOCUMENT, content: { type: 'doc', content: [{ type: 'paragraph' }] }, savedAt: new Date().toISOString() });
