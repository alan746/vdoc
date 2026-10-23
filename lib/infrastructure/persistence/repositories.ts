import type { DocumentRepository, LibraryRepository, VersionRepository } from '../../usecases/ports';
import * as documents from './document-store';
import { STORAGE_KEY } from './storage';
import * as library from './library-store';
import * as versions from './version-store';

// IndexedDB adapters for the persistence ports. Each method delegates at call
// time, so a store module is only touched when the operation runs.

export const indexedDbDocuments: DocumentRepository = {
  get changeKey() { return STORAGE_KEY; },
  select: id => documents.selectDocument(id),
  readActive: requestedId => documents.readSavedDocument(requestedId),
  save: (title, content, documentId) => documents.saveDocument(title, content, documentId),
  activate: document => documents.activateDocument(document),
};

export const indexedDbLibrary: LibraryRepository = {
  list: () => library.listLibrary(),
  createDocument: (document, parentId) => library.createLibraryDocument(document, parentId),
  createFolder: (title, parentId) => library.createFolder(title, parentId),
  update: (id, patch) => library.updateLibraryItem(id, patch),
  copy: id => library.copyLibraryDocument(id),
  deleteTrashed: (id, expected) => library.deleteTrashedDocument(id, expected),
};

export const indexedDbVersions: VersionRepository = {
  save: (document, label) => versions.saveVersion(document, label),
  list: documentId => versions.listVersions(documentId),
  restore: (key, current) => versions.restoreVersion(key, current),
};
