import type { JSONContent } from '@tiptap/core';
import { exportHTML } from '../export/html-export';
import { fitPreviewTables, previewPageWidth } from './preview-layout';
import { preparePreviewParagraphBorders } from './preview-paragraph-borders';
import { preparePreviewPageBreaks } from './preview-page-breaks';

const cssText = (text: unknown) => '"' + String(text || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r\n|\r|\n/g, '\\A ') + '"';
/** Bound text-node length in the disposable preview so bidi range offsets stay local. */
export function segmentPreviewText(root: HTMLElement) {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = []; let next: Node | null;
  while ((next = walker.nextNode())) if ((next.textContent || '').length > 256) nodes.push(next as Text);
  const segmenter = new Intl.Segmenter(undefined, { granularity:'word' });
  for (const node of nodes) {
    const fragment = root.ownerDocument.createDocumentFragment(); let chunk = '';
    const flush = () => { if (!chunk) return; const span = root.ownerDocument.createElement('span'); span.dataset.previewRun = ''; span.textContent = chunk; fragment.appendChild(span); chunk = ''; };
    for (const { segment } of segmenter.segment(node.data)) {
      if (segment.length > 256) {
        // URLs and unbroken words still need bounded ranges; never split a grapheme.
        for (const part of new Intl.Segmenter(undefined, { granularity:'grapheme' }).segment(segment)) { chunk += part.segment; if (chunk.length >= 128) flush(); }
      } else { chunk += segment; if (chunk.length >= 128) flush(); }
    }
    flush(); node.replaceWith(fragment);
  }
}

export function previewSource(title: string, html: string, content: JSONContent) {
  const parsed = new DOMParser().parseFromString(exportHTML(title, html, content), 'text/html');
  const attrs = content.attrs || {};
  const css = parsed.querySelector('style')!.textContent + `
    @page { size:${attrs.pageSize === 'letter' ? 'letter' : 'A4'} ${attrs.orientation === 'landscape' ? 'landscape' : 'portrait'}; margin:${Number(attrs.pageMargin) || 20}mm;
      @top-center { content:${attrs.header ? cssText(attrs.header) : 'none'}; white-space:pre-wrap; overflow-wrap:anywhere; font:12px/1.3 Arial; }
      @bottom-left { content:${attrs.footer ? cssText(attrs.footer) : 'none'}; white-space:pre-wrap; overflow-wrap:anywhere; font:12px/1.3 Arial; }
      @bottom-right { content:${attrs.pageNumbers ? 'counter(page) " / " counter(pages)' : 'none'}; white-space:nowrap; min-width:${attrs.pageNumbers ? '5em' : '0'}; font:12px Arial; }
    }
    body { margin:0; padding:0; max-width:none; font:16px/1.75 Arial,sans-serif; }
    p { margin:10px 0; orphans:2; widows:2; overflow-wrap:break-word; } td p,th p { margin:0; } h1,h2,h3,h4,h5,h6 { break-after:avoid; }
    table { table-layout:fixed; font-size:14px; } td,th { overflow-wrap:anywhere; } .tableWrapper { margin:16px 0; overflow:visible; }
    tr { break-inside:avoid; } thead { break-inside:avoid; }
    .page-break { break-after:page; height:0; margin:0; border:0; } .page-break span { display:none; }
    .page-break + * { break-before:page; }
    .pagedjs_page { background:${/^#[\da-f]{6}$/i.test(attrs.pageColor || '') ? attrs.pageColor : '#fff'}; }
    a { color:#405ad6; text-decoration:underline; } img { max-width:100%; }
  `;
  parsed.querySelectorAll('header,footer').forEach(node => node.remove());
  parsed.querySelectorAll('input').forEach(input => { input.disabled = true; });
  parsed.body.querySelectorAll('p,h1,h2,h3,h4,h5,h6,pre').forEach((node, index) => node.setAttribute('data-preview-block', String(index)));
  parsed.body.querySelectorAll('table').forEach((node,index)=>node.setAttribute('data-preview-table',String(index)));
  parsed.body.querySelectorAll('tr').forEach((node,index)=>node.setAttribute('data-preview-row',String(index)));
  parsed.body.querySelectorAll('td,th').forEach((node,index)=>node.setAttribute('data-preview-cell',String(index)));
  const fittedTables = fitPreviewTables(parsed.body, previewPageWidth(content));
  preparePreviewParagraphBorders(parsed.body);
  preparePreviewPageBreaks(parsed.body);
  segmentPreviewText(parsed.body);
  return { html: parsed.body.innerHTML, css, fittedTables, language: attrs.language === 'und' ? '' : attrs.language || '' };
}

/** Add headers before layout measures a continued body row, so they consume page space. */
export function repeatTableHeaders(clone: Node, source: Node) {
  const target = clone instanceof Element ? clone : clone.parentElement;
  const original = source instanceof Element ? source : source.parentElement;
  let table = target?.closest('table');
  let sourceTable = original?.closest('table');
  while (table && sourceTable) {
    if (table.querySelector(':scope > tbody') && !table.querySelector(':scope > thead')) {
      const head = sourceTable.querySelector(':scope > thead');
      if (head) {
        const repeated = head.cloneNode(true) as HTMLElement;
        repeated.dataset.repeatedHeader = 'true';
        table.insertBefore(repeated, table.firstChild);
      }
    }
    // On the first table node Paged.js still has to render its original colgroup.
    // Inserting one there duplicates the columns and doubles the printed width.
    if (table.querySelector(':scope > tbody') && !table.querySelector(':scope > colgroup')) {
      const cols = sourceTable.querySelector(':scope > colgroup');
      if (cols) table.insertBefore(cols.cloneNode(true), table.firstChild);
    }
    table = table.parentElement?.closest('table') || null;
    sourceTable = sourceTable.parentElement?.closest('table') || null;
  }
}

/** A missing/duplicated text block must not be presented as a successful preview. */
export function previewTextMatches(source: HTMLElement, pages: HTMLElement): boolean {
  const blocks = '[data-preview-block],p[data-block-id],h1[data-block-id],h2[data-block-id],h3[data-block-id],h4[data-block-id],h5[data-block-id],h6[data-block-id],pre[data-block-id]';
  const blockId = (node: HTMLElement) => node.dataset.blockId || `preview:${node.dataset.previewBlock}`;
  const collect = (root: HTMLElement) => {
    const values = new Map<string,string[]>();
    root.querySelectorAll<HTMLElement>(blocks).forEach(node => {
      if (node.closest('[data-repeated-header]')) return;
      const id = blockId(node);
      // textContent omits <br>. Keep each explicit line separately while
      // joining text/inline wrappers and page fragments of the same block.
      // Literal newlines in code remain text, not synthetic break markers.
      const lines = values.get(id) || [''];
      const walker = node.ownerDocument.createTreeWalker(node, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
      let part: Node | null;
      while ((part = walker.nextNode())) {
        if (part.nodeType === Node.TEXT_NODE) lines[lines.length - 1] += part.textContent || '';
        else if ((part as Element).tagName === 'BR') lines.push('');
      }
      values.set(id, lines);
    });
    return values;
  };
  const before = collect(source), after = collect(pages);
  if (JSON.stringify([...before]) !== JSON.stringify([...after])) return false;
  // Audit object/text order within each logical cell separately. A table's
  // left/right paragraph fragments legitimately interleave across physical
  // pages; the surrounding document sees the table as one logical object.
  const order = (root: HTMLElement) => {
    const scopes = new Map<string, string[]>();
    root.querySelectorAll<HTMLElement>(`${blocks},table,img,hr`).forEach(node => {
      if (node.closest('[data-repeated-header]')) return;
      const cell = node.parentElement?.closest<HTMLElement>('td,th');
      const scope = cell ? `cell:${cell.dataset.previewCell || cell.dataset.blockId || ''}` : 'document';
      const entries = scopes.get(scope) || [];
      const kind = node.tagName === 'TABLE' ? 'table' : node.matches(blocks) ? 'block' : node.tagName;
      const id = kind === 'block' ? blockId(node) : kind === 'table' ? node.dataset.previewTable || node.dataset.blockId || '' : node.dataset.blockId || '';
      const entry = JSON.stringify([kind, id, node.tagName === 'IMG' ? node.getAttribute('src') : null]);
      // Only text blocks and tables can split. Repeated images/rules are loss
      // of fidelity even when adjacent and carrying the same stable ID.
      if (!['block','table'].includes(kind) || entries.at(-1) !== entry) entries.push(entry);
      scopes.set(scope, entries);
    });
    return [...scopes].sort(([a],[b]) => a.localeCompare(b));
  };
  if (JSON.stringify(order(source)) !== JSON.stringify(order(pages))) return false;
  const images = (root: HTMLElement) => Array.from(root.querySelectorAll('img')).filter(img => !img.closest('[data-repeated-header]')).map(img => `${img.getAttribute('data-block-id') || ''}:${img.getAttribute('src')}`);
  return JSON.stringify(images(source)) === JSON.stringify(images(pages));
}
