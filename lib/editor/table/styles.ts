import type { Ordered } from '../feature';

/** Editor styles; ordering retains the original cascade across feature boundaries. */
/* Transform cells, not tr: WebKit otherwise paints and hit-tests body cells
   above a translated header row despite the row's z-index. */
export const styles: readonly Ordered<string>[] = [
  { order: 52, value: String.raw`
.table-popover { width: 228px; padding: 16px; border-radius: 9px; box-shadow: 0 6px 30px #1f31551a; }
.table-popover > p { font-size: 14px; margin: 0 0 13px; }
` },
  { order: 59, value: String.raw`
.table-popover > p { display: flex; justify-content: space-between; }
.table-popover > p span { color: #7384bc; }
.table-picker-grid { display: grid; grid-template-columns: repeat(8, 1fr); gap: 4px; }
.table-picker-grid button { width: 21px; height: 21px; border: 1px solid #d7dfeb; border-radius: 2px; }
.table-picker-grid button.chosen { border-color: #7188e8; background: #e0e7ff; }
.table-popover small { font-size: 12px; display: block; color: #8a94a6; margin-top: 12px; }
` },
  { order: 125, value: String.raw`
.document-editor table { border-collapse: collapse; table-layout: fixed; width: 100%; margin: 0; overflow: hidden; font-size: 14px; line-height: 1.7; }
.document-editor td, .document-editor th { min-width: 40px; border: 1px solid #dce3ed; padding: 11px 14px; vertical-align: top; position: relative; font-weight: 400; text-align: left; }
.document-editor th { background: #f2f5fa; font-weight: 600; color: #536584; }
.document-editor td p, .document-editor th p { margin: 0; }
.document-editor .tableWrapper { margin: 40px 0 22px; overflow-x: auto; }
.document-editor .vdoc-pinned-row > td, .document-editor .vdoc-pinned-row > th { z-index: 3; transform: translateY(var(--vdoc-pin-offset, 0px)); }
.document-editor .vdoc-pinned-row td { background-color: #fff; }
.document-editor .vdoc-header-stuck .vdoc-pinned-row > td, .document-editor .vdoc-header-stuck .vdoc-pinned-row > th { box-shadow: 0 2px 0 #aeb9ca; }
@media print {
  .document-editor .vdoc-pinned-row > td, .document-editor .vdoc-pinned-row > th { transform: none; box-shadow: none; }
}
.document-editor .selectedCell:after { z-index: 2; position: absolute; content: ''; left: 0; right: 0; top: 0; bottom: 0; background: #7189e833; pointer-events: none; }
.document-editor .column-resize-handle { position: absolute; right: -2px; top: 0; bottom: -2px; width: 4px; background: #8798e2; z-index: 20; pointer-events: none; }
.document-editor.resize-cursor { cursor: col-resize; }
.document-editor.row-resize-cursor { cursor: row-resize; }
.document-editor tr.table-row-resizing { height: var(--vdoc-preview-height) !important; }
.document-editor .table-cell-resizing { height: auto !important; }
.table-resize-badge { position: fixed; z-index: 1000; pointer-events: none; background: #171717; color: #fff; padding: 6px 10px; border-radius: 6px; font: 12px/1.4 Arial, sans-serif; box-shadow: 0 2px 8px #0003; }
.table-resize-badge:empty { display: none; }
` },
  { order: 165, value: String.raw`
.table-context { position: fixed; bottom: 49px; left: 50%; transform: translateX(-50%); background: #fff; border: 1px solid #dfe5f0; box-shadow: 0 5px 25px #33456818; padding: 6px 9px; border-radius: 9px; display: flex; align-items: center; gap: 5px; z-index: 30; }
.table-context > span { display: flex; align-items: center; gap: 6px; color: #8e9ab0; font-size: 12px; padding: 0 10px 0 3px; border-right: 1px solid #e4e9f1; margin-right: 4px; }
.table-context > button { display: flex; align-items: center; justify-content: center; gap: 5px; font-size: 13px; color: #111111; padding: 6px 8px; border-radius: 5px; }
.table-context button:hover { background: #f1f4fb; }
` },
  { order: 210, value: String.raw`
@media (max-width: 600px) { .document-editor table { font-size: 13px; } }
@media (max-width: 600px) { .document-editor td, .document-editor th { padding: 8px; } }
` },
  { order: 217, value: String.raw`
@media print { .table-context { display: none !important; } }
` },
  { order: 223, value: String.raw`
@media print { .document-editor tr { break-inside: avoid; } }
@media print { .document-editor .tableWrapper { overflow: visible; margin-top: 16px; } }
` },
  { order: 237, value: String.raw`
.table-right-menu { position:fixed; z-index:80; display:grid; width:220px; max-height:calc(100vh - 16px); overflow:auto; padding:6px; border:1px solid #d3d9e4; background:#fff; box-shadow:0 8px 30px #0002; border-radius:8px; }
.table-right-menu button { text-align:left; padding:8px 10px; font-size:13px; }
.table-right-menu button:hover { background:#eef2ff; }
.table-right-menu button:disabled { opacity:.35; }
` },
  { order: 259, value: String.raw`
@media print { .table-right-menu { display:none !important; } }
` },
  { order: 285, value: String.raw`
.table-size-form { display:flex; align-items:end; gap:6px; margin:12px 0; font-size:11px; }
.table-size-form input { display:block; width:64px; padding:4px; border:1px solid #cbd3df; border-radius:4px; }
.table-size-form button { padding:5px 8px; border-radius:4px; background:#eef2f8; }
` },
  { order: 396, value: String.raw`
.table-insert-dialog .table-picker-grid { width:228px; gap:6px; }
.table-insert-dialog .table-picker-grid button { width:23px; height:23px; }
.table-insert-dialog .table-picker-grid button:focus-visible { outline:2px solid #1e3a8a; outline-offset:2px; }
.table-right-menu { max-height:min(480px,calc(100dvh - 16px)); width:232px; overflow-y:auto; overscroll-behavior:contain; }
.table-right-menu button:focus-visible { background:#e8eef9; outline:2px solid #233b71; outline-offset:-2px; }
.table-hover-tools { position: fixed; z-index: 45; display: flex; padding: 2px; border: 1px solid #b9c4d3; border-radius: 6px; background: #fff; box-shadow: 0 2px 6px #16243d18; color: #111827; }
.table-hover-tools button { display: flex; align-items: center; justify-content: center; width: 26px; height: 24px; border-radius: 3px; }
.table-hover-tools button:hover { background: #e8eef6; }
.table-hover-tools button:focus-visible { outline: 2px solid #2563eb; outline-offset: 1px; }
.table-hover-tools button[aria-label^="Drag"] { cursor: grab; }
.table-hover-tools button[aria-label^="Drag"]:active { cursor: grabbing; }
.table-drop-line { position: fixed; z-index: 46; background: #2563eb; pointer-events: none; }
.table-drop-line.invalid { background: #b91c1c; }
.table-drop-status { position: fixed; z-index: 46; bottom: 48px; left: 50%; transform: translateX(-50%); background: #111827; color: white; border-radius: 6px; padding: 8px 14px; font-size: 12px; pointer-events: none; }
@media print { .table-hover-tools, .table-drop-line, .table-drop-status { display: none; } }
` },
];
