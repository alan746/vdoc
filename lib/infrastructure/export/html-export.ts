import { printContainerLayout as container } from '../preview/print-containers';
import { formatOverrideCSS } from '../../editor/format/format-overrides';
import { prepareParagraphBorderGroups, PARAGRAPH_BORDER_GROUP_CSS } from '../../editor/paragraph/paragraph-border-groups';
import { LIST_MARKER_CSS } from '../../editor/list/list-markers';
import { preparePrintTables } from '../preview/print-tables';
import type { JSONContent } from '@tiptap/core';
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]!);
export function exportHTML(title: string, html: string, content: JSONContent) {
  const notes: {number: number; text: string}[] = [];
  const walk = (n: JSONContent) => { if (n.type === 'footnote') notes.push(n.attrs as typeof notes[number]); n.content?.forEach(walk); }; walk(content);
  const a = content.attrs || {};
  return `<!doctype html><html lang="${escape(a.language === 'und' ? '' : a.language || '')}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)}</title><style>
body{max-width:760px;margin:60px auto;font:16px/1.75 Arial,sans-serif;color:#222f43;padding:0 24px;background:${escape(a.pageColor || '#FFFFFF')}}
table{border-collapse:collapse;width:100%}td,th{border:1px solid #ced4df;padding:10px;text-align:left}th{background:#f1f4f8}blockquote{margin:1em ${container.quoteMargin}px;border-left:${container.quoteBorder}px solid #536bb1;padding-left:${container.quotePadding}px}img{max-width:100%;height:auto}pre{white-space:pre-wrap;padding:16px;background:#f1f4f8}h1,h2,h3,h4,h5,h6{break-after:avoid}p{orphans:2;widows:2}h1{font-size:32px}h2{font-size:22px}header,footer,.notes{font-size:12px;white-space:pre-wrap}.notes{border-top:1px solid #ccd3dd;margin-top:32px}.page-break{border-top:1px dashed #ccd3dd;margin:24px 0;color:#68778d}ul{list-style:disc}ol{list-style:decimal}ul,ol{padding-left:${container.listPadding}px;margin:13px 0}li{padding-left:${container.itemPadding}px;margin:7px 0}li p{margin-top:0;margin-bottom:0}ul[data-type=taskList]{list-style:none;padding-left:0}ul[data-type=taskList]>li{display:flex;align-items:baseline;gap:${container.taskGap}px;padding:0}ul[data-type=taskList]>li>label{flex:0 0 ${container.taskLabel}px;width:${container.taskLabel}px}ul[data-type=taskList]>li>div{flex:1;min-width:0}ul[data-type=taskList]:not([data-strike-completed=false])>li[data-checked=true]>div>:is(p,h1,h2,h3,h4,h5,h6){text-decoration:line-through;color:#7d899b}
${LIST_MARKER_CSS}
${PARAGRAPH_BORDER_GROUP_CSS}
@media print{.page-break + *{break-before:page}}
@media print{@page{size:${a.pageSize === 'letter' ? 'letter' : 'A4'} ${a.orientation === 'landscape' ? 'landscape' : 'portrait'};margin:${Number(a.pageMargin)||20}mm}body{margin:0;padding:0;max-width:none}.page-break{break-after:page;border:0;height:0;margin:0}.page-break span{display:none}tr{break-inside:avoid}thead{display:table-header-group;break-inside:avoid}tbody{display:table-row-group}.tableWrapper{overflow:visible}table{overflow:visible}}
${formatOverrideCSS}</style></head><body>${a.header ? `<header>${escape(a.header)}</header>` : ''}${prepareParagraphBorderGroups(preparePrintTables(html))}${notes.length ? `<section class="notes">${notes.map(n=>`<p><sup>${n.number}</sup> ${escape(n.text)}</p>`).join('')}</section>` : ''}${a.footer ? `<footer>${escape(a.footer)}</footer>` : ''}</body></html>`;
}
