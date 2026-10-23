import type { EditorFeature } from '../feature';
import { createShortcuts } from './extensions';

/** Routing that intentionally spans features (Tab, history, and formatting shortcuts). */
export const keyboardFeature = {
  id: 'keyboard',
  extensions: options => options.onShortcut ? [{ order: 3500, value: createShortcuts(options) }] : [],
  commands: {},
} satisfies EditorFeature;
