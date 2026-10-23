import type { Ordered } from '../feature';

/** Editor styles; ordering retains the original cascade across feature boundaries. */
export const styles: readonly Ordered<string>[] = [
  { order: 102, value: String.raw`
.document-editor { padding: 66px 73px 80px; min-height: 970px; outline: none; font-family: Arial, 'PingFang SC', 'Microsoft YaHei', sans-serif; font-size: 16px; line-height: 1.85; color: #364152; overflow-wrap: break-word; caret-color: #405ad6; }
.document-editor ::selection { background: #d5e0fc; }
.document-editor > :first-child { margin-top: 0; }
` },
  { order: 120, value: String.raw`
.document-editor blockquote { border-left: 3px solid #7186cb; padding: 2px 0 2px 18px; margin: 22px 0; color: #6c7b93; }
.document-editor hr { border: 0; border-top: 1px solid #e6eaf1; margin: 26px 0; }
` },
  { order: 124, value: String.raw`
.document-editor pre { background: #f0f3f9; padding: 15px; border-radius: 5px; white-space: pre-wrap; }
` },
  { order: 142, value: String.raw`
.document-editor .ProseMirror-selectednode { outline: 2px solid #9baaea; }
.document-editor .is-editor-empty:first-child:before { content: attr(data-placeholder); float: left; height: 0; color: #b0b8c7; pointer-events: none; }
` },
  { order: 207, value: String.raw`
@media (max-width: 600px) { .document-editor { padding: 34px 24px 55px; min-height: 760px; } }
` },
  { order: 221, value: String.raw`
@media print { .document-editor { min-height: 0; padding: 0; } }
` },
];
