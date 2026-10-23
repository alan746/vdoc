import { indexedDbDocuments, indexedDbLibrary, indexedDbVersions } from '../infrastructure/persistence/repositories';
import type { DocumentRepository, LibraryRepository, VersionRepository } from '../usecases/ports';

type Repositories = { documents: DocumentRepository; library: LibraryRepository; versions: VersionRepository };
let selected: Repositories = { documents: indexedDbDocuments, library: indexedDbLibrary, versions: indexedDbVersions };
let cloudOwner: string | null = null;
export function configureCloudRepositories(owner: string, repositories: Repositories) {
  if (typeof window === 'undefined') throw new Error('Cloud cache selection belongs to a browser tab.');
  if (cloudOwner && cloudOwner !== owner) throw new Error('Reload before switching accounts.');
  cloudOwner = owner; selected = repositories;
}
export const isCloudWorkspace = () => cloudOwner !== null;
// Select once before mounting the editor. Full-page links separate workspace modes.
export const documents: DocumentRepository = {
  select: id => selected.documents.select(id), readActive: id => selected.documents.readActive(id),
  save: (title, content, id) => selected.documents.save(title, content, id), activate: draft => selected.documents.activate(draft),
  watchExternalChanges: (id, listener) => selected.documents.watchExternalChanges(id, listener),
};
export const library: LibraryRepository = {
  list: () => selected.library.list(), createDocument: (draft, parent) => selected.library.createDocument(draft, parent),
  createFolder: (title, parent) => selected.library.createFolder(title, parent), update: (id, patch) => selected.library.update(id, patch),
  copy: id => selected.library.copy(id), deleteTrashed: (id, expected) => selected.library.deleteTrashed(id, expected),
};
export const versions: VersionRepository = {
  save: (document, label) => selected.versions.save(document, label), list: id => selected.versions.list(id),
  restore: (key, current) => selected.versions.restore(key, current),
};
