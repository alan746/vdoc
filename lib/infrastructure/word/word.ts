import { wordLineSpacing } from '../../editor/paragraph/paragraph-line-height';
import { paragraphSides, paragraphBorderEdges, type ParagraphBorders } from '../../editor/paragraph/paragraph-borders';
import { bulletGlyphs } from '../../editor/list/list-style';
import { absoluteFontPixels } from '../../domain/text/font-size';
import { wordParagraphIndent } from '../../editor/paragraph/paragraph-indent';
import { DEFAULT_TAB_INTERVAL, wordTabPositions } from '../../editor/paragraph/paragraph-tabs';
import { cellBorder, borderSides } from '../../editor/table/table-borders';
import { canonicalLanguage } from '../../domain/text/language';
import type { JSONContent } from '@tiptap/core';
import { generateJSON } from '@tiptap/core';
import { createExtensions } from '../../editor/extensions';

// Mammoth appends one separator space and a backlink to each note. Remove only
// those generated characters; trim() would also discard the user's indentation.
function footnoteText(note: Element): string {
  const copy = note.cloneNode(true) as Element;
  copy.querySelectorAll('a[href^="#footnote-ref-"]').forEach(link => {
    const previous = link.previousSibling;
    if (previous?.nodeType === 3 && previous.textContent?.endsWith(' ')) previous.textContent = previous.textContent.slice(0, -1);
    const parent = link.parentElement;
    link.remove();
    // A note ending in a table has a separate generated backlink paragraph.
    if (parent?.tagName === 'P' && !parent.textContent && parent.previousElementSibling?.tagName === 'TABLE') parent.remove();
  });
  const block = (node: ChildNode) => node.nodeType === 1 && /^(P|H[1-6]|PRE|BLOCKQUOTE|UL|OL|LI|TABLE|THEAD|TBODY|TFOOT|TR|TD|TH|DIV)$/.test((node as Element).tagName);
  const read = (node: Node): string => {
    if (node.nodeType === 3) return node.textContent || '';
    if (node.nodeType !== 1) return '';
    const element = node as Element;
    if (element.tagName === 'BR') return '\n';
    const children = Array.from(element.childNodes);
    return children.map((child, i) => {
      const separator = i && (block(child) || block(children[i - 1])) ? element.tagName === 'TR' ? '\t' : '\n' : '';
      return separator + read(child);
    }).join('');
  };
  return read(copy);
}

/** Converts a Word file locally. Import favors editable structure over page fidelity. */
export async function importWord(buffer: ArrayBuffer): Promise<{ content: JSONContent; warnings: string[] }> {
  const { restoreWordFormatting, normalizeWordCarriageReturns } = await import('./word-import-formatting');
  buffer = await normalizeWordCarriageReturns(buffer);
  const tabWarnings: string[] = [];
  const { prepareWordNumbering } = await import('./word-numbering-inheritance');
  buffer = await prepareWordNumbering(buffer, tabWarnings);
  const { prepareWordBlockquotes } = await import('./word-blockquotes');
  const quotes = await prepareWordBlockquotes(buffer);
  const mammoth = await import('mammoth');
  const result = await mammoth.convertToHtml({ arrayBuffer: quotes.buffer }, { ignoreEmptyParagraphs: false, styleMap: [...quotes.styleMap, ...Array.from({length:9}, (_, level) => `table[style-name='VDoc List Table ${level}'] => ${'ul|ol > li > '.repeat(level + 1)}table:fresh`), "u => u", "strike => s", "r[style-name='VDoc Inline Code'] => code", "p[style-name='VDoc Code Block'] => pre:fresh", ...Array.from({length:9}, (_, level) => `p[style-name='VDoc List Code ${level}'] => ${'ul|ol > li > '.repeat(level + 1)}pre:fresh`), "p[style-name='VDoc Divider'] => p.vdoc-word-divider:fresh", ...Array.from({length:9}, (_, level) => `p[style-name='VDoc List Image ${level}'] => ${'ul|ol > li > '.repeat(level + 1)}p.vdoc-word-list-image:fresh`), ...Array.from({length:9}, (_, level) => `p[style-name='VDoc List Page Break ${level}'] => ${'ul|ol > li > '.repeat(level + 1)}p:fresh`), ...Array.from({length:9}, (_, level) => `p[style-name='VDoc List Divider ${level}'] => ${'ul|ol > li > '.repeat(level + 1)}p.vdoc-word-divider:fresh`), ...Array.from({length:9},(_,level)=>Array.from({length:6},(_,h)=>[false,true].map(ordered=>`p[style-name='VDoc List Heading ${level} ${h+1} ${ordered?'Ordered':'Bullet'}'] => ${'ul|ol > li > '.repeat(level)}${ordered?'ol':'ul'} > li:fresh > h${h+1}:fresh`))).flat(2), ...Array.from({length:7}, (_, heading) => `p[style-name='VDoc Static Checklist H${heading}'] => ${heading ? `h${heading}` : 'p'}:fresh`), ...Array.from({length:9}, (_, level) => Array.from({length:7}, (_, heading) => `p[style-name='VDoc List Continuation ${level} ${heading}'] => ${'ul|ol > li > '.repeat(level + 1)}${heading ? `h${heading}` : 'p'}:fresh`)).flat(), ...Array.from({length:9}, (_, level) => [false,true].map(ordered => `p:${ordered ? 'ordered' : 'unordered'}-list(${level + 1}) => ${'ul|ol > li > '.repeat(level)}${ordered ? 'ol' : 'ul'} > li:fresh > p:fresh`)).flat()] });
  if (result.value.length > 20_000_000) throw new Error('The expanded document exceeds the 20 MB import limit.');
  const parsed = new DOMParser().parseFromString(result.value, 'text/html');
  quotes.restore(parsed, tabWarnings);
  const pageSettings = await restoreWordFormatting(buffer, parsed, tabWarnings);
  // Keep the Word carrier during format matching, then lift only images out
  // of it. An empty paragraph before a block image would otherwise be fitted
  // into the list item. Preserve carriers with externally added text/objects.
  parsed.querySelectorAll('p.vdoc-word-list-image').forEach(paragraph => {
    if (paragraph.childNodes.length && Array.from(paragraph.childNodes).every(node => node.nodeType === 1 && (node as Element).tagName === 'IMG')) {
      paragraph.replaceWith(...Array.from(paragraph.childNodes));
    }
  });
  // Restore only our explicitly tagged empty carriers. Text or inline objects
  // added by another editor must remain editable, never be replaced by a rule.
  parsed.querySelectorAll('p.vdoc-word-divider').forEach(paragraph => {
    if (!paragraph.childNodes.length) paragraph.replaceWith(parsed.createElement('hr'));
  });
  parsed.querySelectorAll('a[href^="#footnote-"]:not([href^="#footnote-ref-"])').forEach(link => {
    const id = link.getAttribute('href')!.slice(1), note = parsed.getElementById(id);
    if (!note) return;
    const ref = parsed.createElement('sup'); ref.setAttribute('data-note', footnoteText(note)); ref.textContent = (link.textContent || '1').replace(/[\[\]]/g, '');
    const wrapper = link.parentElement;
    if (wrapper?.tagName === 'SUP' && wrapper.childNodes.length === 1) wrapper.replaceWith(ref); else link.replaceWith(ref);
  });
  parsed.querySelectorAll('li[id^="footnote-"]').forEach(note => { const parent = note.parentElement; note.remove(); if (!parent?.children.length) parent?.remove(); });
  parsed.querySelectorAll('script,style,iframe,object,embed,link').forEach(el => el.remove());
  parsed.querySelectorAll('*').forEach(el => {
    for (const attr of Array.from(el.attributes)) if (attr.name.startsWith('on')) el.removeAttribute(attr.name);
    if (el.hasAttribute('href') && !/^(https?:\/\/|mailto:)/i.test(el.getAttribute('href')!)) el.removeAttribute('href');
    if (el.tagName === 'IMG' && !/^data:image\/(png|jpeg|gif|webp);base64,/i.test(el.getAttribute('src') || '')) el.remove();
  });
  const content = generateJSON(parsed.body.innerHTML, createExtensions()); content.attrs = { ...content.attrs, ...pageSettings };
  return { content, warnings: [...result.messages.map(m => m.message), ...tabWarnings] };
}
const hex = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return;
  if (/^#[\da-f]{6}$/i.test(value)) return value.slice(1);
  const rgb = value.match(/^rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)$/);
  return rgb ? rgb.slice(1).map(n => Math.min(255, +n).toString(16).padStart(2, '0')).join('') : undefined;
};

// CSSOM quotes font families containing spaces. Word expects one typeface name,
// not CSS quotes or a fallback-family list. Keep commas inside quoted names.
function wordFontFamily(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  const match = value.match(/^\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^,]+))/);
  const family = match?.slice(1).find(part => part !== undefined)?.trim();
  return family?.replace(/\\([\da-f]{1,6}\s?|.)/gi, (_, escape: string) => {
    if (!/^[\da-f]{1,6}\s?$/i.test(escape)) return escape;
    const point = parseInt(escape.trim(), 16);
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : '\uFFFD';
  }) || undefined;
}

export async function exportWord(content: JSONContent, title: string): Promise<Blob> {
  const d = await import('docx');
  const literalText = (text: string) => text.split(/(\r\n|\r|\n|\t)/).map(part => part === '\t' ? new d.Tab()
    : /^(\r\n|\r|\n)$/.test(part) ? new d.CarriageReturn() : part);
  type Paragraph = InstanceType<typeof d.Paragraph>;
  type Table = InstanceType<typeof d.Table>;
  // A block content control carries quote boundaries without inserting blank
  // paragraphs. Paragraph's public serializer hook also fits table-cell APIs.
  class QuoteBlock extends d.Paragraph {
    private readonly container: InstanceType<typeof d.BuilderElement>;
    constructor(children: (Paragraph | Table)[], level: number) {
      super({});
      this.container = new d.BuilderElement({name:'w:sdt',children:[
        new d.BuilderElement({name:'w:sdtPr',children:[new d.BuilderElement({name:'w:tag',attributes:{val:{key:'w:val',value:`vdoc:blockquote:v1:list=${level}`}}})]}),
        new d.BuilderElement({name:'w:sdtContent',children}),
      ]});
    }
    override prepForXml(context: import('docx').IContext) { return this.container.prepForXml(context); }
  }
  type Inline = InstanceType<typeof d.TextRun> | InstanceType<typeof d.ExternalHyperlink> | InstanceType<typeof d.ImageRun> | InstanceType<typeof d.FootnoteReferenceRun>;
  const footnotes: Record<string, { children: Paragraph[] }> = {};
  let listId = 0;
  const listHeadingStyles = new Map<string,{level:number;heading:number;ordered:boolean}>();
  const checklistStyles = new Set<number>();
  const dividerStyles = new Set<number>();
  const listCodeStyles = new Set<number>();
  const listImageStyles = new Set<number>();
  const listTableStyles = new Set<number>();
  const listBreakStyles = new Set<number>();
  const continuationStyles = new Map<string, {level:number; heading:number}>();
  const numbering: import('docx').INumberingOptions['config'][number][] = [];
  const inlines = (nodes: JSONContent[] = [], completed = false, heading = false): Inline[] => nodes.flatMap<Inline>(node => {
    if (node.type === 'footnote') { const number = node.attrs?.number || 1; footnotes[number] = { children: [new d.Paragraph({children:[new d.TextRun({children:literalText(node.attrs?.text || '')})]})] }; return [new d.FootnoteReferenceRun(number)]; }
    if (node.type === 'hardBreak') return [new d.TextRun({ break: 1 })];
    if (node.type !== 'text') return [];
    const marks = node.marks || [], has = (name: string) => marks.some(m => m.type === name), attr = (name: string) => marks.find(m => m.type === name)?.attrs || {};
    const style = attr('textStyle'), highlight = hex(attr('highlight').color);
    const fontPixels = absoluteFontPixels(style.fontSize);
    if (style.fontSize && fontPixels === null) throw new Error('Word export cannot preserve a relative or invalid font size. Set an explicit font size in the toolbar, then export again.');
    const run = new d.TextRun({ style: has('code') ? 'VDocInlineCode' : undefined, children: (node.text || '').split('\t').flatMap((text, i) => [...(i ? [new d.Tab()] : []), text]), bold: has('bold') || (heading && !attr('formatOverride').boldOff), italics: has('italic'), underline: has('underline') ? {} : attr('formatOverride').underlineOff ? { type: d.UnderlineType.NONE } : undefined, strike: has('strike') || completed, superScript: has('superscript'), subScript: has('subscript'), color: hex(style.color) || (completed ? '7D899B' : undefined), font: wordFontFamily(style.fontFamily) || (has('code') ? 'Courier New' : undefined), size: fontPixels !== null ? Math.round(fontPixels * 1.5) : undefined, shading: highlight ? { fill: highlight } : undefined });
    return has('link') ? [new d.ExternalHyperlink({ link: attr('link').href, children: [run] })] : [run];
  });
  const blocks = async (nodes: JSONContent[] = [], list?: { reference: string; level: number; task?: boolean; checked?: boolean; strikeCompleted?: boolean; ordered?: boolean }, header = false, quoteDepth = 0, continuation = false): Promise<(Paragraph | Table)[]> => {
    const output: (Paragraph | Table)[] = [];
    let previousOrderedReference: string | undefined;
    let firstListParagraph = !continuation;
    for (const node of nodes) {
      const a = node.attrs || {};
      if (node.type === 'paragraph' || node.type === 'heading') {
        const continuation = list && !list.task && !firstListParagraph;
        const continuationStyle = continuation ? `VDocListContinuation${list.level}H${node.type === 'heading' ? a.level : 0}` : undefined;
        if (continuationStyle) continuationStyles.set(continuationStyle, {level:list!.level,heading:node.type === 'heading' ? a.level : 0});
        const taskHeading = node.type === 'heading' ? a.level : 0;
        const listHeadingStyle = list && !list.task && firstListParagraph && taskHeading ? `VDocListHeading${list.level}H${taskHeading}${list.ordered?'Ordered':'Bullet'}` : undefined;
        if(listHeadingStyle)listHeadingStyles.set(listHeadingStyle,{level:list!.level,heading:taskHeading,ordered:!!list!.ordered});
        if (list?.task) checklistStyles.add(taskHeading);
        const prefix = list?.task && firstListParagraph ? [new d.TextRun(list.checked ? '☑ ' : '☐ ')] : [];
        output.push(new d.Paragraph({ border: a.paragraphBorders ? Object.fromEntries((a.paragraphBorderJoin ? paragraphBorderEdges : paragraphSides).map(side=>{const edge=(a.paragraphBorders as ParagraphBorders)[side];return [side,edge?{style:edge.style==='dashed'?d.BorderStyle.DASHED:edge.style==='dotted'?d.BorderStyle.DOTTED:d.BorderStyle.SINGLE,size:Math.max(1,Math.round(edge.width*6)),color:hex(edge.color),space:edge.padding}:{style:d.BorderStyle.NONE}];})) : undefined, shading: a.paragraphBackground ? {type:d.ShadingType.CLEAR,fill:hex(a.paragraphBackground),color:'auto'} : undefined, style: list?.task ? `VDocStaticChecklistH${taskHeading}` : listHeadingStyle || continuationStyle, children: [...prefix, ...inlines(node.content, !!(list?.task && list.checked && list.strikeCompleted !== false), node.type === 'heading' || header)], tabStops: a.tabInterval !== undefined && a.tabInterval !== DEFAULT_TAB_INTERVAL || node.content?.some(n => n.text?.includes('\t')) ? wordTabPositions(a, (list ? 24*(list.level+1) : 0) + quoteDepth*24).map(position => ({ type: d.TabStopType.START, position })) : undefined, keepNext: a.keepWithNext ?? node.type === 'heading', keepLines: a.keepLinesTogether === true, widowControl: a.preventSingleLines !== false, bidirectional: a.direction === 'rtl' ? true : a.direction === 'ltr' ? false : undefined, heading: node.type === 'heading' && !list ? `Heading${a.level}` as (typeof d.HeadingLevel)[keyof typeof d.HeadingLevel] : undefined, alignment: a.textAlign === 'justify' ? d.AlignmentType.JUSTIFIED : a.textAlign || undefined, indent: wordParagraphIndent(quoteDepth ? {...a,indentStart:a.indentStart ?? (a.indent || 0)*24} : a,(list ? 24*(list.level+1) : 0) + quoteDepth*24), spacing: { before: a.spaceBefore != null ? Math.round(a.spaceBefore * 15) : undefined, after: a.spaceAfter != null ? Math.round(a.spaceAfter * 15) : undefined, ...wordLineSpacing(a.lineHeight) }, numbering: list && !list.task && firstListParagraph ? { reference: list.reference, level: list.level } : undefined }));
        firstListParagraph = false;
      } else if (['bulletList', 'orderedList', 'taskList'].includes(node.type || '')) {
        const continued = node.type === 'orderedList' && a.continuePrevious === true && previousOrderedReference;
        const reference = continued || `list${++listId}`;
        if (node.type === 'orderedList') previousOrderedReference = reference;
        if (!continued) numbering.push({ reference, levels: Array.from({ length: 9 }, (_, level) => ({ level, format: node.type === 'orderedList' ? ({a:d.LevelFormat.LOWER_LETTER,A:d.LevelFormat.UPPER_LETTER,i:d.LevelFormat.LOWER_ROMAN,I:d.LevelFormat.UPPER_ROMAN}[a.type as 'a'|'A'|'i'|'I'] || d.LevelFormat.DECIMAL) : d.LevelFormat.BULLET, text: node.type === 'orderedList' ? `${a.numberPrefix ?? ''}%${level + 1}${a.numberSuffix ?? '.'}` : (a.bulletText || bulletGlyphs[a.bulletStyle as keyof typeof bulletGlyphs] || '•'), start: a.start ?? 1, alignment: d.AlignmentType.LEFT, style: { paragraph: { indent: { left: 360 * (level + 1), hanging: 240 } } } })) });
        for (const item of node.content || []) output.push(...await blocks(item.content, { reference, level: Math.min(8, list ? list.level + 1 : 0), task: node.type === 'taskList', checked: item.attrs?.checked, strikeCompleted: a.strikeCompleted !== false, ordered: node.type === 'orderedList' }, header, quoteDepth));
      } else if (node.type === 'blockquote') {
        output.push(new QuoteBlock(await blocks(node.content, list, header, quoteDepth + 1, !!list), list && !list.task ? list.level : -1));
      } else if (node.type === 'table') {
        const style = list && !list.task ? `VDocListTable${list.level}` : undefined;
        if (list && !list.task) listTableStyles.add(list.level);
        const rows: InstanceType<typeof d.TableRow>[] = [];
        const sourceRows = node.content || [];
        let headerCount = Number.isInteger(a.pinnedRows) ? Math.min(sourceRows.length, a.pinnedRows) : 0;
        if (a.pinnedRows == null) while (headerCount < sourceRows.length && sourceRows[headerCount].content?.length && sourceRows[headerCount].content!.every(cell => cell.type === 'tableHeader')) headerCount++;
        for (let i = 0; i < headerCount; i++) for (const cell of sourceRows[i].content || []) headerCount = Math.min(sourceRows.length, Math.max(headerCount, i + (cell.attrs?.rowspan || 1)));
        for (const row of node.content || []) {
          const cells: InstanceType<typeof d.TableCell>[] = [];
          for (const cell of row.content || []) {
            const ca = cell.attrs || {};
            const borders = Object.fromEntries(borderSides.map(side=>{
              const b = cellBorder(ca,side);
              return [side,{style:b.width === 0 ? d.BorderStyle.NONE : b.style === 'dashed' ? d.BorderStyle.DASHED : b.style === 'dotted' ? d.BorderStyle.DOTTED : d.BorderStyle.SINGLE,size:b.width * 6,color:hex(b.color) || 'DCE3ED'}];
            }));
            const children = await blocks(cell.content, undefined, cell.type === 'tableHeader'); if (!children.length || children[children.length - 1] instanceof d.Table) children.push(new d.Paragraph(''));
            cells.push(new d.TableCell({ children, columnSpan: ca.colspan || 1, rowSpan: ca.rowspan || 1, shading: hex(ca.backgroundColor) ? { fill: hex(ca.backgroundColor) } : undefined, width: ca.colwidth ? { size: ca.colwidth.reduce((sum: number, width: number) => sum + width, 0) * 15, type: d.WidthType.DXA } : undefined, margins: { top: (ca.padding ?? 10) * 15, bottom: (ca.padding ?? 10) * 15, left: (ca.padding ?? 10) * 15, right: (ca.padding ?? 10) * 15 }, verticalAlign: ca.verticalAlign === 'middle' ? d.VerticalAlign.CENTER : ca.verticalAlign === 'bottom' ? d.VerticalAlign.BOTTOM : d.VerticalAlign.TOP, borders }));
          }
          rows.push(new d.TableRow({ children: cells, tableHeader: rows.length < headerCount ? true : undefined, height: (row.attrs?.minHeight || row.content?.some(c => c.attrs?.minHeight)) ? { value: Math.max(row.attrs?.minHeight || 0, ...(row.content || []).map(c => (c.attrs?.minHeight || 0) / (c.attrs?.rowspan || 1))) * 15, rule: d.HeightRule.ATLEAST } : undefined, cantSplit: row.attrs?.allowSplit !== true }));
        }
        // Explicit grid widths must survive export; forcing 100% stretched narrow tables.
        const grid = (node.content?.[0]?.content || []).flatMap(cell => Array.from({length:cell.attrs?.colspan || 1},(_,i)=>cell.attrs?.colwidth?.[i] || 0));
        const fixed = grid.length > 0 && grid.every(width=>width > 0);
        output.push(new d.Table({ rows, style, visuallyRightToLeft: a.columnDirection === 'rtl', alignment: a.alignment === 'center' ? d.AlignmentType.CENTER : a.alignment === 'right' ? d.AlignmentType.RIGHT : d.AlignmentType.LEFT,
          ...(fixed ? {columnWidths:grid.map(width=>width * 15),layout:d.TableLayoutType.FIXED} : {}),
          width: fixed ? {size:grid.reduce((sum,width)=>sum+width,0) * 15,type:d.WidthType.DXA} : { size: 100, type: d.WidthType.PERCENTAGE } }));
      } else if (node.type === 'tableOfContents') { output.push(new d.Paragraph({ text: 'Contents', heading: d.HeadingLevel.HEADING_2 })); for (const item of a.items || []) output.push(new d.Paragraph({ text: item.text, indent: { left: (item.level - 1) * 240 } }));
      } else if (node.type === 'image') {
        const image = await new Promise<HTMLImageElement>((resolve, reject) => { const image = new window.Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('An embedded image could not be decoded.')); image.src = a.src; });
        let data = a.src as string; const type = data.startsWith('data:image/jpeg') ? 'jpg' : data.startsWith('data:image/gif') ? 'gif' : 'png';
        if (data.startsWith('data:image/webp')) { const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight; canvas.getContext('2d')!.drawImage(image, 0, 0); data = canvas.toDataURL('image/png'); }
        const style = list && !list.task ? `VDocListImage${list.level}` : undefined;
        if (list && !list.task) listImageStyles.add(list.level);
        const indent = (list && !list.task ? (list.level + 1)*24 : 0) + quoteDepth*24;
        output.push(new d.Paragraph({ style, indent: indent ? {left:indent*15} : undefined, children: [new d.ImageRun({ data, type: type as 'png' | 'jpg' | 'gif', transformation: { width: a.width || 320, height: a.height > 0 ? a.height : (a.width || 320) * image.naturalHeight / image.naturalWidth }, altText: { name: a.alt || '', title: a.alt || '', description: a.alt || '' } })] }));
      } else if (node.type === 'pageBreak') {
        const style = list && !list.task ? `VDocListPageBreak${list.level}` : undefined;
        if (list && !list.task) listBreakStyles.add(list.level);
        output.push(new d.Paragraph({ style, children: [new d.PageBreak()] }));
      }
      else if (node.type === 'horizontalRule') {
        const style = list && !list.task ? `VDocListDivider${list.level}` : 'VDocDivider';
        if (list && !list.task) dividerStyles.add(list.level);
        output.push(new d.Paragraph({ style, border: { bottom: { style: d.BorderStyle.SINGLE, size: 6, color: 'DCE3ED' } } }));
      }
      else if (node.type === 'codeBlock') {
        // Word needs explicit break/tab elements; literal control characters in
        // w:t do not preserve the editor's code layout in other applications.
        const text = (node.content || []).map(n => n.text || '').join('');
        const children = literalText(text);
        const style = list && !list.task ? `VDocListCode${list.level}` : 'VDocCodeBlock';
        if (list && !list.task) listCodeStyles.add(list.level);
        const indent = (list && !list.task ? (list.level + 1)*24 : 0) + quoteDepth*24;
        output.push(new d.Paragraph({ style, indent: indent ? {left:indent*15} : undefined, children: [new d.TextRun({ children, font: 'Courier New' })] }));
      }
      else output.push(...await blocks(node.content, list, header));
    }
    return output;
  };
  const children = await blocks(content.content), a = content.attrs || {}, margin = (a.pageMargin || 20) * 56.693;
  const language = canonicalLanguage(a.language);
  const languageOptions = language && language !== 'und' ? {value: language, eastAsia: language, bidirectional: language} : undefined;
  const defaultStyles: NonNullable<import('docx').IStylesOptions['default']> = { document: { run: { language: languageOptions, font: 'Arial', size: 24, color: '364152' } }, ...Object.fromEntries([32,19,17,16,15,14].map((pixels,index)=>[`heading${index+1}`,{run:{font:'Arial',size:Math.round(pixels*1.5),bold:true,color:index===0?'24334C':index===1?'283952':'364152'}}])) };
  const wordDocument = new d.Document({ defaultTabStop: DEFAULT_TAB_INTERVAL * 15, styles: { characterStyles: [{id:'VDocInlineCode',name:'VDoc Inline Code',run:{font:'Courier New'}}], paragraphStyles: [...[...listImageStyles].map(level=>({id:`VDocListImage${level}`,name:`VDoc List Image ${level}`,basedOn:'Normal'})), ...[...listBreakStyles].map(level=>({id:`VDocListPageBreak${level}`,name:`VDoc List Page Break ${level}`,basedOn:'Normal'})), ...[...listCodeStyles].map(level=>({id:`VDocListCode${level}`,name:`VDoc List Code ${level}`,basedOn:'VDocCodeBlock'})), {id:'VDocDivider',name:'VDoc Divider',basedOn:'Normal'}, ...[...dividerStyles].map(level=>({id:`VDocListDivider${level}`,name:`VDoc List Divider ${level}`,basedOn:'Normal'})), {id:'VDocCodeBlock',name:'VDoc Code Block',basedOn:'Normal',run:{font:'Courier New'}}, ...[...listHeadingStyles].map(([id,{level,heading,ordered}])=>({id,name:`VDoc List Heading ${level} ${heading} ${ordered?'Ordered':'Bullet'}`,basedOn:`Heading${heading}`})), ...[...checklistStyles].map(heading => ({id:`VDocStaticChecklistH${heading}`,name:`VDoc Static Checklist H${heading}`,basedOn:heading ? `Heading${heading}` : 'Normal'})), ...[...continuationStyles].map(([id, {level,heading}]) => ({id,name:`VDoc List Continuation ${level} ${heading}`,basedOn:heading ? `Heading${heading}` : 'Normal'}))], default: defaultStyles }, title, creator: 'VDoc', footnotes, numbering: { config: numbering }, sections: [{ headers: a.header ? { default: new d.Header({ children: [new d.Paragraph(a.header)] }) } : undefined, footers: a.footer || a.pageNumbers ? { default: new d.Footer({ children: [new d.Paragraph({ children: [new d.TextRun(a.footer || ''), ...(a.pageNumbers ? [new d.TextRun({ children: ['  ', d.PageNumber.CURRENT] })] : [])] })] }) } : undefined, properties: { page: { size: { width: a.pageSize === 'letter' ? 12240 : 11906, height: a.pageSize === 'letter' ? 15840 : 16838, orientation: a.orientation === 'landscape' ? d.PageOrientation.LANDSCAPE : d.PageOrientation.PORTRAIT }, margin: { top: margin, bottom: margin, left: margin, right: margin } } }, children }] });
  // Append our table styles after construction: passing importedStyles replaces
  // docx's defaults, including ListParagraph, heading and footnote styles.
  for (const style of [...listTableStyles].map(level => new d.BuilderElement({name:'w:style',attributes:{type:{key:'w:type',value:'table'},styleId:{key:'w:styleId',value:`VDocListTable${level}`}},children:[new d.BuilderElement({name:'w:name',attributes:{val:{key:'w:val',value:`VDoc List Table ${level}`}}})]}))) wordDocument.Styles.addChildElement(style);
  return d.Packer.toBlob(wordDocument);
}
