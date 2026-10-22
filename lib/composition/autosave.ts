import { saveDocument, STORAGE_KEY } from '../infrastructure/persistence/document-store';
import { createAutosave } from '../usecases/autosave';
export type { InputComposition } from '../usecases/autosave';

// Bindings are read lazily so the store module is only touched when autosave runs.
export const startAutosave = createAutosave({
  get changeKey() { return STORAGE_KEY; },
  save: (title, content, documentId) => saveDocument(title, content, documentId),
});
