import { createAutosave } from '../usecases/autosave';
import { documents } from './repositories';
export type { InputComposition } from '../usecases/autosave';

export const startAutosave = createAutosave(documents);
