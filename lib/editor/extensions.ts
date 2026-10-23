import { editorBundle } from './feature-list';
import type { EditorFeatureOptions } from './feature';

export { StableIds } from './document/stable-ids';

/** Compatibility entry point for editor, HTML import and persistence schema construction. */
export function createExtensions(onShortcut?: EditorFeatureOptions['onShortcut'], onResize?: EditorFeatureOptions['onResize'], onFormat?: EditorFeatureOptions['onFormat']) {
  return editorBundle.extensions({ onShortcut, onResize, onFormat });
}
