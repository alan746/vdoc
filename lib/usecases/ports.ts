import type { JSONContent } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import type { DocumentDraft, DocumentVersion, LibraryItem, LibraryMetadata, SavedDocument, Trash } from '../domain/entities/document';

/** Result of opening the active document; `error` means storage exists but could not be read. */
export type ActiveDocumentRead = { data: SavedDocument | null; error?: undefined } | { data: null; error: string };
export type DocumentImport = { document: DocumentDraft; format: string; warnings: string[] };
export type LibraryItemPatch = { title?: string; parentId?: string | null; starred?: boolean; trash?: boolean; expectedTrashGroup?: string };

// Ports owned by the use-case layer. Infrastructure implements them and
// lib/composition wires the implementations in, so use cases and UI never
// depend on a concrete storage engine or file format.

/** Documents: the active document plus reads and writes by id. */
export interface DocumentRepository {
  /** Storage-event key that signals another tab changed the stored document. */
  readonly changeKey: string;
  /** Opens a document by id (links, library) and makes it active. */
  select(id: string): Promise<SavedDocument>;
  /** Reads the active document, or a specific one when `requestedId` is given. */
  readActive(requestedId?: string): Promise<ActiveDocumentRead>;
  save(title: string, content: JSONContent, documentId: string): Promise<SavedDocument>;
  /** Stores a document (e.g. an import) and makes it the active one. */
  activate(document: DocumentDraft): Promise<SavedDocument>;
}

/** Persistence used by autosave. */
export type DocumentWriter = Pick<DocumentRepository, 'changeKey' | 'save'>;

/** Library organisation: folders, stars, trash. */
export interface LibraryRepository {
  list(): Promise<LibraryItem[]>;
  createDocument(document: DocumentDraft, parentId: string | null): Promise<SavedDocument>;
  /** Returns the new folder id. */
  createFolder(title: string, parentId: string | null): Promise<string>;
  update(id: string, patch: LibraryItemPatch): Promise<LibraryMetadata>;
  copy(id: string): Promise<SavedDocument>;
  /** `expected` is the trash state the caller saw; deletion is refused if storage no longer matches it. */
  deleteTrashed(id: string, expected: Trash): Promise<void>;
}

/** Named checkpoints of a document. */
export interface VersionRepository {
  save(document: SavedDocument, label: string): Promise<DocumentVersion>;
  list(documentId: string): Promise<DocumentVersion[]>;
  /** Restores a checkpoint over `current`, keeping a backup of `current` as a version. */
  restore(key: string, current: SavedDocument): Promise<SavedDocument>;
}

/** Strategy for one importable file format; the first importer that accepts a file handles it. */
export interface FileImporter {
  accepts(file: File): boolean;
  read(file: File, title: string): Promise<DocumentImport>;
}

/** Immutable editor snapshot; conversion must never read a live editor. */
export type DocumentExportSource = { title: string; doc: Node; html: string; json: JSONContent };
/** Finished sheets, shared by preview and paginated exporters. */
export type PaginatedExportSource = {
  title: string; html: string; css: string; pages: number;
  pageSize: 'a4' | 'letter'; orientation: 'portrait' | 'landscape';
};
export type FileExportOptions = { signal?: AbortSignal };
export type ExportNotice = { code: string; message: string };
export type ExportPayload = { blob: Blob; notices?: readonly ExportNotice[] };

/** Conversion only. Naming, download delivery and UI lifecycle are separate. */
export interface FileExporter<Source = DocumentExportSource> {
  write(source: Source, options?: FileExportOptions): ExportPayload | Promise<ExportPayload>;
}

/** App-owned realtime boundary; only infrastructure imports the provider SDK. */
export interface RealtimeToolContext {
  signal: AbortSignal; callId: string; turnId: string; epoch: number;
}
export interface RealtimeTool {
  description: string;
  parameters: { readonly [key: string]: unknown };
  run(input: unknown, context: RealtimeToolContext): unknown;
}
export type RealtimeStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';
export interface RealtimeConnection {
  interrupt(reason?: 'user' | 'keyboard'): void;
  sendText(text: string): void;
  close(): void;
}
export interface RealtimeConfig {
  url: string;
  tokenUrl: string;
  audio?: boolean;
}
export interface RealtimePort {
  open(options: {
    config: RealtimeConfig; docId: string; sessionId: string;
    tools: Record<string, RealtimeTool>; signal: AbortSignal;
    onStatus(status: RealtimeStatus, message?: string): void;
  }): RealtimeConnection;
}
