import { indexedDbDocuments, indexedDbLibrary, indexedDbVersions } from '../infrastructure/persistence/repositories';
import type { DocumentRepository, LibraryRepository, VersionRepository } from '../usecases/ports';

// The app's persistence. Swap these bindings to change the storage backend
// (e.g. a server API) without touching use cases or UI.
export const documents: DocumentRepository = indexedDbDocuments;
export const library: LibraryRepository = indexedDbLibrary;
export const versions: VersionRepository = indexedDbVersions;
