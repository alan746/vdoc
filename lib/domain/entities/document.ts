import type { JSONContent } from '@tiptap/core';
// Core VDoc entities. Persistence, import and UI layers share these shapes.
export type SavedDocument = { version: 1; id?: string; title: string; content: JSONContent; savedAt: string };
export type LibraryEntry = { id: string; title: string; savedAt: string };
export type LibraryItem = LibraryEntry & { kind: 'document' | 'folder'; parentId: string | null; starred: boolean; trashedAt?: string; trashGroup?: string };
export type DocumentVersion = { key: string; documentId: string; label: string; createdAt: string; sequence?: number; document: SavedDocument };
export type DocumentImport = { document: SavedDocument; format: 'word' | 'text' | 'backup'; warnings: string[] };
/** A document that has been persisted and therefore always has an id. */
export type StoredDocument = SavedDocument & { id: string };
/** Organisation state of a library item (folder placement, star, trash). */
export type LibraryMetadata = { id: string; parentId: string | null; starred: boolean; trashedAt?: string; trashGroup?: string };
export type LibraryItemPatch = { title?: string; parentId?: string | null; starred?: boolean; trash?: boolean; expectedTrashGroup?: string };
/** The trash state the caller saw; deletion is refused if storage no longer matches it. */
export type TrashExpectation = { trashedAt: string; trashGroup?: string };
/** Result of opening the active document; `error` means storage exists but could not be read. */
export type ActiveDocumentRead = { data: SavedDocument | null; error?: string };
