import type { Ordered } from '../feature';

/** Editor styles; ordering retains the original cascade across feature boundaries. */
export const styles: readonly Ordered<string>[] = [
  { order: 251, value: String.raw`
.document-editor img { display:block; max-width:100%; height:auto; margin:14px 0; }
` },
  { order: 257, value: String.raw`
.page-break { border-top:1px dashed #aab7cc; text-align:center; margin:28px 0; font:11px Arial; color:#8490a3; user-select:none; }
.page-break span { background:#fff; position:relative; top:-8px; padding:0 10px; }
` },
  { order: 260, value: String.raw`
@media print { .page-break { break-after:page; border:0; margin:0; height:0; } }
@media print { .page-break span { display:none; } }
` },
  { order: 263, value: String.raw`
.image-preview { grid-column:1 / -1; max-width:100%; max-height:180px; object-fit:contain; }
.footnote-ref { color:#405ad6; font-size:.75em; cursor:help; }
.document-notes { padding:12px 73px 36px; font:13px/1.65 Arial; white-space:pre-wrap; }
.document-notes::before { content:''; display:block; width:150px; border-top:1px solid #9caac0; margin-bottom:10px; }
.document-toc { border:1px solid #dbe2ec; border-radius:4px; padding:18px; margin:16px 0; font-size:14px; }
.document-toc strong { display:block; margin-bottom:8px; }
` },
  { order: 270, value: String.raw`
@media print { .document-notes { padding:12px 0; } }
` },
  { order: 278, value: String.raw`
.document-editor [data-resize-wrapper] { max-width:100%; }
.document-editor [data-resize-handle] { width:11px; height:11px; border:2px solid white; border-radius:2px; background:#405ad6; z-index:3; opacity:0; transform:translate(50%,50%); }
.document-editor [data-resize-handle='bottom-left'] { transform:translate(-50%,50%); cursor:nesw-resize; }
.document-editor [data-resize-handle='bottom-right'] { cursor:nwse-resize; }
.document-editor [data-resize-container]:hover [data-resize-handle], .document-editor [data-resize-container].ProseMirror-selectednode [data-resize-handle] { opacity:1; }
@media print { .document-editor [data-resize-handle] { display:none; } }
` },
  { order: 288, value: String.raw`
.document-editor [data-resize-container] { width:fit-content; max-width:100%; margin:14px 0; }
.document-editor [data-resize-wrapper] img { margin:0; }
` },
];
