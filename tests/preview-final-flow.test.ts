import { expect, it, vi } from 'vitest';
import { finalizePreviewFlow } from '../lib/editor/preview-final-flow';
import { previewOverflowDetails } from '../lib/editor/preview-layout';
import { previewTextMatches } from '../lib/editor/paged-preview';
const parse=(html:string)=>{const root=document.createElement('div');root.innerHTML=html;return root;};
const body='<table data-preview-table="0"><tbody><tr><td rowspan="2"><p data-preview-block="0">中文 العربية</p></td><td><p data-preview-block="1">A</p></td></tr><tr><td><p data-preview-block="2">B</p></td></tr></tbody></table>';
it('removes measuring columns only from final page content and preserves the complete table DOM',()=>{
  const root=parse(`<div class="pagedjs_page"><div class="pagedjs_area"><div class="pagedjs_page_content" style="column-width:642px;column-gap:1151px;height:971px"><div>${body}</div></div></div></div>`);
  const content=root.querySelector<HTMLElement>('.pagedjs_page_content')!, before=content.innerHTML;
  finalizePreviewFlow(root);
  expect(content.style.columnWidth).toBe('auto');expect(content.style.columnCount).toBe('auto');expect(content.style.columnGap).toBe('normal');expect(content.style.display).toBe('flow-root');
  expect(content.style.getPropertyPriority('column-width')).toBe('important');expect(content.style.height).toBe('971px');
  expect(content.innerHTML).toBe(before);expect(previewTextMatches(parse(body),root)).toBe(true);
  const finalized=root.innerHTML;finalizePreviewFlow(root);expect(root.innerHTML).toBe(finalized);
});
it('does not touch editor content, margin boxes or intentional document columns',()=>{
  const root=parse('<div class="document-editor" style="column-width:200px">Editor</div><div class="pagedjs_margin-content" style="column-width:100px">Header</div>');
  const before=root.innerHTML;finalizePreviewFlow(root);expect(root.innerHTML).toBe(before);
});
it('still rejects genuine overflow after removing the temporary column flow',()=>{
  const root=parse(`<div class="pagedjs_area"><div class="pagedjs_page_content">${body}</div></div>`);
  vi.spyOn(root.firstElementChild!,'getBoundingClientRect').mockReturnValue(new DOMRect(0,0,642,971));
  vi.spyOn(root.querySelector('table')!,'getBoundingClientRect').mockReturnValue(new DOMRect(0,700,642,300));
  finalizePreviewFlow(root);
  expect(previewOverflowDetails(root)).toEqual({page:1,kind:'table',edge:'bottom',pixels:29});
});
