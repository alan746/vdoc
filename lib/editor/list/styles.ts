import type { Ordered } from '../feature';

/** Editor styles; ordering retains the original cascade across feature boundaries. */
/* Keep custom marker rules in sync with LIST_MARKER_CSS used by HTML/preview. */
export const styles: readonly Ordered<string>[] = [
  { order: 114, value: String.raw`
.document-editor ul, .document-editor ol { padding-left: 24px; margin: 13px 0; }
.document-editor ul { list-style: disc; }
.document-editor ol { list-style: decimal; }
.document-editor li { padding-left: 5px; margin: 7px 0; }
.document-editor li::marker { color: #7a879f; }
.document-editor li p { margin: 0; }
` },
  { order: 252, value: String.raw`
.document-editor ul[data-type='taskList'] { padding:0; list-style:none; }
.document-editor ul[data-type='taskList'] > li { display:flex; align-items:baseline; gap:9px; padding:0; }
.document-editor ul[data-type='taskList'] > li > label { flex:none; user-select:none; }
.document-editor ul[data-type='taskList'] > li > div { flex:1; min-width:0; }
.document-editor ul[data-type='taskList']:not([data-strike-completed='false']) > li[data-checked='true'] > div > :is(p,h1,h2,h3,h4,h5,h6) { text-decoration:line-through; color:#7d899b; }
` },
  { order: 421, value: String.raw`
ol[data-number-prefix] > li::marker { content: var(--vdoc-prefix) counter(list-item,var(--vdoc-counter-style)) var(--vdoc-suffix) " "; }
ul[data-bullet-text] > li::marker { content: var(--vdoc-bullet) " "; }
.checklist-preview > div { display:flex; align-items:baseline; gap:9px; margin:12px 0; }
.checklist-preview input { width:auto; margin:0; }
` },
];
