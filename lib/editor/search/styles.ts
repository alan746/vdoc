import type { Ordered } from '../feature';

/** Editor styles; ordering retains the original cascade across feature boundaries. */
export const styles: readonly Ordered<string>[] = [
  { order: 229, value: String.raw`
.find-panel { display:flex; flex-wrap:wrap; align-items:center; gap:8px; padding:10px 20px; border-bottom:1px solid #d8dfeb; background:#fff; font-size:12px; }
.find-panel input:not([type='checkbox']) { width:155px; padding:7px 9px; border:1px solid #c8d0df; border-radius:5px; color:#111; }
.find-panel button { padding:5px; border-radius:4px; }
.find-panel button:hover { background:#eef2ff; }
.find-panel button:disabled { opacity:.4; }
.find-panel label { display:flex; align-items:center; gap:4px; }
.document-editor .vdoc-search-match { background:#fff1a8; color:#182230; }
.document-editor .vdoc-search-current { background:#ffbd59; color:#111827; outline:2px solid #a85200; outline-offset:1px; }
` },
  { order: 259, value: String.raw`
@media print { .find-panel { display:none !important; } }
` },
];
