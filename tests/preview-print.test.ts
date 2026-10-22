import { expect, it } from 'vitest';
import { installPreviewPrintStyle } from '../lib/infrastructure/preview/preview-print';

it.each([
  ['a4','portrait',210,297],['a4','landscape',297,210],
  ['letter','portrait',215.9,279.4],['letter','landscape',279.4,215.9],
])('prints %s %s as complete physical sheets without a second set of margins',(pageSize,orientation,width,height)=>{
  const source={type:'doc',attrs:{pageSize,orientation,pageMargin:20}};
  const before=JSON.stringify(source);
  const cleanup=installPreviewPrintStyle(document,source);
  const css=document.head.querySelector('[data-preview-print]')!.textContent!;
  expect(css).toContain(`@page vdoc-sheet { size: ${width}mm ${height}mm; margin: 0 !important;`);
  expect(css).toContain(`width: ${width}mm !important; height: ${height}mm !important;`);
  expect(css).toContain('break-inside: avoid-page');
  expect(css).toContain('.pagedjs_page:last-child { page-break-after: auto; break-after: auto; }');
  expect(css).toContain('break-before: auto !important');
  expect(JSON.stringify(source)).toBe(before);
  cleanup();expect(document.head.querySelector('[data-preview-print]')).toBeNull();
});
it('defaults safely and cleans up only the style owned by this preview',()=>{
  const other=document.createElement('style');other.textContent='@media print { @page { margin:20mm; } }';document.head.appendChild(other);
  const cleanup=installPreviewPrintStyle(document,{type:'doc'});
  const last=document.head.lastElementChild!;
  expect(last.textContent).toContain('size: 210mm 297mm');
  expect(last.textContent).not.toContain('overflow: hidden');
  cleanup();cleanup();expect(other.isConnected).toBe(true);other.remove();
});

it.each([['a4','portrait',210],['a4','landscape',297],['letter','portrait',215.9],['letter','landscape',279.4]])('keeps the native print root as wide as %s %s sheets for WebKit scaling', (pageSize,orientation,width)=>{
  const cleanup=installPreviewPrintStyle(document,{type:'doc',attrs:{pageSize,orientation}});
  const css=document.head.querySelector('[data-preview-print]')!.textContent!;
  expect(css).toContain(`html, body { width: ${width}mm !important; min-width: ${width}mm !important; max-width: none !important;`);
  expect(css).toContain(`#preview-pages { padding: 0; width: ${width}mm !important; min-width: ${width}mm !important; }`);
  expect(css).not.toContain('width: auto');
  cleanup();
});
