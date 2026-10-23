import { createAutosave } from '../usecases/autosave';
import { documents } from './repositories';

export const startAutosave = createAutosave(documents);
