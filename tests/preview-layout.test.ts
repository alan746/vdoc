import { expect, it, vi } from 'vitest';
import { fitPreviewTables, previewOverflowPage, previewPageWidth } from '../lib/editor/preview-layout';
import { previewSource, previewTextMatches, repeatTableHeaders, segmentPreviewText } from '../lib/editor/paged-preview';
const parse = (html: string) => { const root = document.createElement('div'); root.innerHTML = html; return root; };
const rect = (x: number, y: number, width: number, height: number) => new DOMRect(x,y,width,height);
const table = (widths: number[]) => `<table dir="rtl" style="width:${widths.reduce((a,b)=>a+b,0)}px"><colgroup>${widths.map(w=>`<col style="width:${w}px;min-width:40px">`).join('')}</colgroup><tbody><tr>${widths.map((_,i)=>`<td><p data-block-id="p${i}">Column ${i} العربية</p></td>`).join('')}</tr></tbody></table>`;
it.each([['a4','portrait',20,170],['a4','landscape',20,257],['letter','portrait',15,185.9],['letter','landscape',15,249.4]])('uses %s %s page width minus both margins', (pageSize,orientation,pageMargin,mm) => {
  expect(previewPageWidth({attrs:{pageSize,orientation,pageMargin}})).toBeCloseTo(Number(mm)*96/25.4);
});
it('fits wide tables with proportional widths without changing fonts, direction or source markup', () => {
  const html = table([450,900,450]), root = parse(html);
  expect(fitPreviewTables(root,601)).toBe(1);
  expect([...root.querySelectorAll('col')].map(c=>parseFloat(c.style.width))).toEqual([150,300,150]);
  expect(root.querySelector('table')!.dir).toBe('rtl'); expect(root.querySelector('table')!.style.width).toBe('600px');
  expect(root.textContent).toBe(parse(html).textContent); expect(root.innerHTML).not.toContain('font-size');
  expect(fitPreviewTables(root,601)).toBe(0); expect(parse(html).querySelector('table')!.style.width).toBe('1800px');
});
it('preserves narrow tables unchanged', () => {
  const root=parse(table([100,200]));const before=root.innerHTML;expect(fitPreviewTables(root,640)).toBe(0);expect(root.innerHTML).toBe(before);
});
it('fits a table inside two list levels to the remaining content width', () => {
  const html=`<ul><li><p>Parent</p><ol><li>${table([400,800])}</li></ol></li></ul>`,root=parse(html);
  expect(fitPreviewTables(root,601)).toBe(1);
  expect(parseFloat(root.querySelector('table')!.style.width)).toBe(542);
  expect(root.textContent).toBe(parse(html).textContent);
  expect(parse(html).querySelector('table')!.style.width).toBe('1200px');
  const fitted=root.innerHTML;expect(fitPreviewTables(root,601)).toBe(0);expect(root.innerHTML).toBe(fitted);
});
it('subtracts list indentation inside a table cell only once', () => {
  const root=parse(`<ul><li>${table([400,800])}</li></ul>`);
  root.querySelector('td')!.appendChild(parse(`<ol><li>${table([500,500])}</li></ol>`).firstChild!);
  expect(fitPreviewTables(root,601)).toBe(2);
  const [outer,inner]=root.querySelectorAll('table');
  expect(parseFloat(outer.style.width)).toBe(571);
  expect(parseFloat(inner.style.width)).toBeCloseTo(571/3-22-29-1);
});
it('accounts for quote margins and task label space without removing either', () => {
  const root=parse(`<blockquote><ul data-type="taskList"><li><label><input type="checkbox"></label><div>${table([900])}</div></li></ul></blockquote>`);
  expect(fitPreviewTables(root,601)).toBe(1);
  expect(root.querySelector('table')!.style.width).toBe('472px');
  expect(root.querySelector('blockquote input[type=checkbox]')).not.toBeNull();
});
it('fits the preserved Word roundtrip overflow sample without altering saved content', async () => {
  const {readFileSync}=await import('node:fs'),{Editor}=await import('@tiptap/core'),{createExtensions}=await import('../lib/editor/extensions');
  const content=JSON.parse(readFileSync('tests/fixtures/combined-workflow-20261010/nested-table-overflow-content.json','utf8'));
  const editor=new Editor({extensions:createExtensions(),content});
  try {
    const before=editor.getJSON(),source=previewSource('Nested table',editor.getHTML(),before),root=parse(source.html);
    const fitted=root.querySelector('table')!;
    expect(fitted.closest('ul ul')).not.toBeNull();
    expect(parseFloat(fitted.style.width)).toBeLessThanOrEqual(previewPageWidth(before)-59);
    expect(editor.getJSON()).toEqual(before);
  } finally {editor.destroy();}
});
it('fits nested tables to their owning cell after fitting the parent', () => {
  const root=parse(table([400,800]));root.querySelector('td')!.appendChild(parse(table([500,500])).firstChild!);
  expect(fitPreviewTables(root,601)).toBe(2);expect(parseFloat(root.querySelectorAll('table')[1].style.width)).toBe(177);
});
it('does not duplicate a colgroup while the first table node is still being rendered', () => {
  const source=parse(table([100,200])),target=parse('<table></table>');repeatTableHeaders(target.firstChild!,source.firstChild!);
  expect(target.querySelector('colgroup')).toBeNull();
});
it('audits generated footnote paragraphs that do not have document block IDs', () => {
  const source=previewSource('Notes','<p data-block-id="p">Body</p>',{type:'doc',content:[{type:'footnote',attrs:{number:1,text:'Footnote العربية'}}]});
  const original=parse(source.html),bad=parse(source.html);bad.querySelector('.notes p')!.remove();expect(previewTextMatches(original,bad)).toBe(false);
});
it('bounds a single unbroken word without splitting emoji or combining graphemes', () => {
  const value='a'.repeat(600)+'👨‍👩‍👧‍👦é'.repeat(100), root=parse(`<p>${value}</p>`);segmentPreviewText(root);
  expect(root.textContent).toBe(value);expect([...root.querySelectorAll('span')].every(s=>s.textContent!.length<270)).toBe(true);
  expect([...root.querySelectorAll('span')].every(s=>!s.textContent!.startsWith('\u200d')&&!s.textContent!.startsWith('\u0301'))).toBe(true);
});
it.each(['table','img','hr','input'])('rejects a clipped %s even when its DOM content exists', tag => {
  const root=parse(`<div class="pagedjs_area"><${tag}></${tag}></div>`),area=root.firstElementChild!,element=area.firstElementChild!;
  vi.spyOn(area,'getBoundingClientRect').mockReturnValue(rect(10,10,600,800));
  vi.spyOn(element,'getBoundingClientRect').mockReturnValue(rect(10,10,1200,50));expect(previewOverflowPage(root)).toBe(1);
});
it('reports the actual page of vertical overflow', () => {
  const root=parse('<div class="pagedjs_area"></div><div class="pagedjs_area"><img></div>');
  root.querySelectorAll('.pagedjs_area').forEach(a=>vi.spyOn(a,'getBoundingClientRect').mockReturnValue(rect(0,0,600,800)));
  vi.spyOn(root.querySelector('img')!,'getBoundingClientRect').mockReturnValue(rect(0,750,50,100));expect(previewOverflowPage(root)).toBe(2);
});
it('rejects a border cap extending beyond the printable page even if all text fits',()=>{
  const root=parse('<div class="pagedjs_area"><span data-preview-border-line="bottom"></span></div>');
  vi.spyOn(root.firstElementChild!,'getBoundingClientRect').mockReturnValue(rect(0,0,600,800));
  vi.spyOn(root.querySelector('span')!,'getBoundingClientRect').mockReturnValue(rect(0,799,600,8));
  expect(previewOverflowPage(root)).toBe(1);
});
it('accepts fitting objects and subpixel border rounding', () => {
  const root=parse('<div class="pagedjs_area"><table></table></div>');vi.spyOn(root.firstElementChild!,'getBoundingClientRect').mockReturnValue(rect(10,10,600,800));
  vi.spyOn(root.querySelector('table')!,'getBoundingClientRect').mockReturnValue(rect(9.5,10,601,800));expect(previewOverflowPage(root)).toBeNull();
});
it('checks visible text ranges, not only element boxes', () => {
  const root=parse('<div class="pagedjs_area"><p>Unbroken text</p></div>');vi.spyOn(root.firstElementChild!,'getBoundingClientRect').mockReturnValue(rect(0,0,600,800));
  const spy=vi.spyOn(Range.prototype,'getClientRects').mockReturnValue([rect(0,0,900,16)] as unknown as DOMRectList);
  expect(previewOverflowPage(root)).toBe(1);spy.mockRestore();
});

it.each([
  ['left',rect(-12,20,100,40),12],
  ['right',rect(550,20,80,40),30],
  ['top',rect(20,-9.2,80,40),10],
  ['bottom',rect(20,790,80,40),30],
] as const)('reports the %s edge and excess size without copying document text', async (edge, box, pixels) => {
  const { previewOverflowDetails } = await import('../lib/editor/preview-layout');
  const root=parse('<div class="pagedjs_area"><img alt="Private image label"></div>');
  vi.spyOn(root.firstElementChild!,'getBoundingClientRect').mockReturnValue(rect(0,0,600,800));
  vi.spyOn(root.querySelector('img')!,'getBoundingClientRect').mockReturnValue(box);
  expect(previewOverflowDetails(root)).toEqual({page:1,kind:'image',edge,pixels});
});
it('distinguishes unavailable layout from a genuinely oversized object', async () => {
  const { previewOverflowDetails, previewOverflowMessage } = await import('../lib/editor/preview-layout');
  const root=parse('<div class="pagedjs_area"></div>');
  const issue=previewOverflowDetails(root)!;
  expect(issue).toEqual({page:1,kind:'page area',edge:'size',pixels:0});
  expect(previewOverflowMessage(issue)).toBe('Page 1 could not be measured. Close the preview and try again.');
});

it('resolves automatic table and column widths before a browser fragments the flow', () => {
  const html='<table style="min-width:80px"><colgroup><col style="min-width:40px"><col style="min-width:40px"></colgroup><tr><td>中文</td><td>العربية</td></tr></table>';
  const root=parse(html); expect(fitPreviewTables(root,601)).toBe(0);
  const output=root.querySelector('table')!;
  expect(output.style.width).toBe('600px');expect(output.style.minWidth).toBe('0');expect(output.style.maxWidth).toBe('600px');
  expect([...root.querySelectorAll('col')].map(col=>col.style.width)).toEqual(['300px','300px']);
  const before=root.innerHTML;expect(fitPreviewTables(root,601)).toBe(0);expect(root.innerHTML).toBe(before);
  expect(parse(html).querySelector('table')!.style.width).toBe('');expect(root.textContent).toBe('中文العربية');
});
it('allocates remaining page width to automatic columns without overwriting a manually sized column', () => {
  const root=parse('<table><colgroup><col style="width:200px"><col style="min-width:40px"><col style="min-width:40px"></colgroup><tr><td>A</td><td>B</td><td>C</td></tr></table>');
  expect(fitPreviewTables(root,701)).toBe(0);
  expect([...root.querySelectorAll('col')].map(col=>col.style.width)).toEqual(['200px','250px','250px']);
});
it('fits an oversized partially sized table proportionally and resolves nested automatic tables to their actual cell', () => {
  const root=parse('<table><colgroup><col style="width:900px"><col style="min-width:40px"></colgroup><tr><td>A</td><td>B</td></tr></table>');
  expect(fitPreviewTables(root,601)).toBe(1);
  expect([...root.querySelectorAll('col')].reduce((sum,col)=>sum+parseFloat(col.style.width),0)).toBeCloseTo(600);
  const nested=parse('<table><colgroup><col style="width:200px"><col style="min-width:40px"></colgroup><tr><td>A</td><td><table><colgroup><col style="min-width:40px"></colgroup><tr><td>B</td></tr></table></td></tr></table>');
  expect(fitPreviewTables(nested,701)).toBe(0);
  expect([...nested.querySelectorAll('table')].map(table=>table.style.width)).toEqual(['700px','477px']);
});
it('resolves percentage tables relative to the printable page rather than the fragmented container', () => {
  const root=parse('<table style="width:50%"><tr><td>Text</td></tr></table>');
  expect(fitPreviewTables(root,601)).toBe(0);expect(root.querySelector('table')!.style.width).toBe('300px');
});

it('gives the exact user Safari backup concrete printable widths without changing its saved document', async () => {
  const { readFileSync } = await import('node:fs');
  const { Editor } = await import('@tiptap/core');
  const { createExtensions } = await import('../lib/editor/extensions');
  const backup=JSON.parse(readFileSync('tests/fixtures/safari-preview/source.vdoc.json','utf8'));
  const editor=new Editor({extensions:createExtensions(),content:backup.content});
  try {
    const before=editor.getJSON();
    const preview=previewSource(backup.title,editor.getHTML(),before),root=parse(preview.html),table=root.querySelector('table')!;
    const expected=previewPageWidth(before)-1;
    expect(parseFloat(table.style.width)).toBeCloseTo(expected);
    expect([...table.querySelectorAll(':scope > colgroup > col')].map(col=>parseFloat((col as HTMLElement).style.width))).toEqual([expected/2,expected/2]);
    expect(table.rows).toHaveLength(37);expect(table.tHead!.rows).toHaveLength(1);
    expect(root.textContent).toContain('IME test area: 中文输入测试.');
    expect(root.querySelector('img')!.getAttribute('width')).toBe('300');
    expect(editor.getJSON()).toEqual(before);expect(preview.fittedTables).toBe(0);
  } finally { editor.destroy(); }
});
