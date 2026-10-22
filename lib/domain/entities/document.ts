import type { JSONContent } from '@tiptap/core';
// Core VDoc entities. Persistence, import and UI layers share these shapes.
export type SavedDocument = { version: 1; id?: string; title: string; content: JSONContent; savedAt: string };
export type LibraryEntry = { id: string; title: string; savedAt: string };
export type LibraryItem = LibraryEntry & { kind: 'document' | 'folder'; parentId: string | null; starred: boolean; trashedAt?: string; trashGroup?: string };
export type DocumentVersion = { key: string; documentId: string; label: string; createdAt: string; sequence?: number; document: SavedDocument };
export type DocumentImport = { document: SavedDocument; format: 'word' | 'text' | 'backup'; warnings: string[] };
