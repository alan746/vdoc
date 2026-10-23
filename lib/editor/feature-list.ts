import { documentFeature } from './document';
import { listFeature } from './list';
import { tableFeature } from './table';
import { paragraphFeature } from './paragraph';
import { formatFeature } from './format';
import { searchFeature } from './search';
import { blocksFeature } from './blocks';
import { keyboardFeature } from './keyboard';
import { composeEditorFeatures } from './compose-features';

/** The single enablement point for editor extensions, commands, styles and backup rules. */
export const editorFeatures = [documentFeature, listFeature, tableFeature, paragraphFeature, formatFeature, searchFeature, blocksFeature, keyboardFeature] as const;
export const editorBundle = composeEditorFeatures(editorFeatures);
