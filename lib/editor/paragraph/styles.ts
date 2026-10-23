import type { Ordered } from '../feature';

/** Editor styles; ordering retains the original cascade across feature boundaries. */
/* Measured in document pixels; CSS zoom scales both paper and ruler. */
export const styles: readonly Ordered<string>[] = [
  { order: 86, value: String.raw`
.paragraph-ruler { position: sticky; top: 0; z-index: 12; height: 42px; margin-bottom: 8px; background: #f3f5f9; border-bottom: 1px solid #c5cbd4; color: #374151; user-select: none; }
.ruler-track { position: absolute; top: 0; height: 41px; background: #fff; border-inline: 1px solid #a6afbd; }
.ruler-tick { position: absolute; bottom: 0; height: 6px; border-left: 1px solid #c1c7d0; font-size: 9px; padding-left: 3px; }
.ruler-tick.major { height: 19px; border-color: #7b8797; }
.ruler-unit { position: absolute; left: 5px; top: 3px; font-size: 9px; color: #4b5563; }
.ruler-handle { position: absolute; transform: translateX(-50%); width: 22px; height: 20px; padding: 0; background: transparent; border: 0; cursor: ew-resize; touch-action: none; z-index: 2; display: grid; place-items: center; border-radius: 3px; }
.ruler-handle:hover { background: #dce5ff; }
.ruler-handle:focus-visible { outline: 2px solid #172554; outline-offset: 1px; background: #dce5ff; }
.ruler-firstLine { top: 0; }
.ruler-start, .ruler-end { top: 21px; }
.ruler-firstLine > span { width: 12px; height: 5px; background: #1e40af; border-radius: 1px; }
.ruler-start > span, .ruler-end > span { width: 0; height: 0; border-inline: 6px solid transparent; border-top: 8px solid #1e40af; }
.ruler-guide { position: absolute; top: 0; height: 320px; width: 1px; background: linear-gradient(#1e40af 70%, transparent); pointer-events: none; z-index: 3; }
.ruler-guide > span { position: absolute; top: 44px; left: 7px; padding: 3px 7px; border-radius: 4px; background: #172554; color: white; font-size: 11px; white-space: nowrap; }
.ruler-empty { display: block; text-align: center; padding-top: 12px; font-size: 11px; color: #64748b; }
` },
  { order: 105, value: String.raw`
.document-editor h1 { font-size: 32px; font-weight: 650; line-height: 1.4; color: #24334c; margin: 15px 0 13px; letter-spacing: -.8px; }
.document-editor h2 { font-size: 19px; font-weight: 600; line-height: 1.5; margin: 32px 0 13px; color: #283952; letter-spacing: .1px; }
.document-editor h3 { font-size: 17px; font-weight: 600; margin: 24px 0 10px; }
.document-editor p { margin: 10px 0; min-height: 1em; }
` },
  { order: 205, value: String.raw`
@media (max-width: 600px) { .paragraph-ruler { display: none; } }
` },
  { order: 208, value: String.raw`
@media (max-width: 600px) { .document-editor h1 { font-size: 27px; } }
@media (max-width: 600px) { .document-editor h2 { font-size: 19px; } }
` },
  { order: 217, value: String.raw`
@media print { .paragraph-ruler { display: none !important; } }
` },
  { order: 222, value: String.raw`
@media print { .document-editor h1, .document-editor h2, .document-editor h3 { break-after: avoid; } }
` },
  { order: 248, value: String.raw`
.document-editor h4 { font-size:16px; font-weight:600; margin:20px 0 8px; }
.document-editor h5 { font-size:15px; font-weight:600; margin:18px 0 8px; }
.document-editor h6 { font-size:14px; font-weight:600; margin:16px 0 8px; }
` },
];
