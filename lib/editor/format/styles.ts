import type { Ordered } from '../feature';

/** Editor styles; ordering retains the original cascade across feature boundaries. */
export const styles: readonly Ordered<string>[] = [
  { order: 109, value: String.raw`
.document-editor strong { font-weight: 650; color: inherit; }
.document-editor em { font-style: italic; }
.document-editor s { text-decoration: line-through; }
.document-editor u { text-decoration: underline; text-underline-offset: 3px; }
.document-editor mark { border-radius: 2px; padding: 2px 0; color: inherit; box-decoration-break: clone; }
` },
  { order: 122, value: String.raw`
.document-editor a { color: #405ad6; text-decoration: underline; cursor: pointer; }
.document-editor code { font-family: monospace; background: #f0f3f9; padding: 2px 4px; border-radius: 3px; font-size: .9em; }
` },
  { order: 425, value: String.raw`
.document-editor [data-vdoc-format-override][data-underline-off="true"] a { text-decoration:none; }
` },
];
