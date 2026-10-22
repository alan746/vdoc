import type { JSONContent } from '@tiptap/core';
import type { DocumentImport, SavedDocument } from '../domain/entities/document';

// Ports owned by the use-case layer. Infrastructure implements them and
// lib/composition wires the implementations in, so use cases never import storage or file formats.

/** Persistence used by autosave. */
export interface DocumentWriter {
  /** Storage-event key that signals another tab changed the stored document. */
  readonly changeKey: string;
  save(title: string, content: JSONContent, documentId: string): Promise<SavedDocument>;
}

/** Strategy for one importable file format; the first importer that accepts a file handles it. */
export interface FileImporter {
  accepts(file: File): boolean;
  read(file: File, title: string): Promise<DocumentImport>;
}
