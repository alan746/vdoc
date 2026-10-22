/** Compare logical header content, not Paged.js wrappers or decorative border
 * spans. Repeated headers are excluded from body text counts but still need an
 * independent completeness check on every table fragment. */
function headerFlow(cell: Element) {
  const tokens: (string | (string | null)[])[] = [];
  const structural = new Set(['P','H1','H2','H3','H4','H5','H6','PRE','UL','OL','LI','TABLE','THEAD','TBODY','TFOOT','TR','TD','TH']);
  const attributes = ['rowspan','colspan','start','type','data-type','data-checked','data-number-prefix','data-number-suffix','data-bullet-text'];
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || '', previous = tokens.at(-1);
      // Paged.js can wrap or split text nodes without changing content.
      if (typeof previous === 'string') tokens[tokens.length - 1] = previous + text;
      else if (text) tokens.push(text);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as Element, tag = element.tagName;
    if (element.hasAttribute('data-preview-border-line')) return;
    if (tag === 'BR' || tag === 'HR' || tag === 'IMG') {
      tokens.push([tag, ...(tag === 'IMG' ? [element.getAttribute('src'),element.getAttribute('alt')] : [])]);
      return;
    }
    const boundary = structural.has(tag);
    if (boundary) tokens.push(['open', tag, ...attributes.map(name => element.getAttribute(name))]);
    element.childNodes.forEach(visit);
    if (boundary) tokens.push(['close', tag]);
  };
  cell.childNodes.forEach(visit);
  return tokens;
}
function headerSignature(head: Element) {
  return JSON.stringify(Array.from(head.children).filter(row => row.tagName === 'TR').map(row =>
    Array.from(row.children).filter(cell => cell.matches('td,th')).map(cell => ({
      tag: cell.tagName,
      rows: cell.getAttribute('rowspan') || '1',
      cols: cell.getAttribute('colspan') || '1',
      text: cell.textContent || '',
      flow: headerFlow(cell),
      images: Array.from(cell.querySelectorAll('img')).map(img => [img.getAttribute('src'),img.getAttribute('alt')]),
      paragraphs: Array.from(cell.querySelectorAll('[data-preview-block]')).map(p => [
        p.getAttribute('data-preview-block'),p.tagName,p.textContent,
        p.getAttribute('data-paragraph-borders'),p.getAttribute('data-paragraph-border-join'),
      ]),
    }))
  ));
}
/** Returns the first page with a missing, duplicated or altered table header. */
export function previewTableHeaderMismatch(source: HTMLElement, pages: HTMLElement): number | null {
  const expected = new Map<string,string|null>();
  source.querySelectorAll('table[data-preview-table]').forEach(table => {
    const head = table.querySelector(':scope > thead');
    expected.set(table.getAttribute('data-preview-table')!, head ? headerSignature(head) : null);
  });
  const rendered = pages.querySelectorAll('.pagedjs_page');
  for (let index=0; index<rendered.length; index++) {
    for (const table of rendered[index].querySelectorAll('table')) {
      const id = table.getAttribute('data-preview-table');
      if (id === null || !expected.has(id)) return index+1;
      const heads = table.querySelectorAll(':scope > thead'), signature = expected.get(id);
      if (signature === null ? heads.length !== 0 : heads.length !== 1 || headerSignature(heads[0]) !== signature) return index+1;
    }
  }
  return null;
}

/** Every fragment must preserve cell ownership, column spans and order.
 * A row's first fragment must contain every cell that begins in that row.
 * Paged.js can otherwise defer sibling cells until the last fragment of a tall
 * rowspan cell. All text survives, but columns no longer line up on the page. */
export function previewTableRowMismatch(source: HTMLElement, pages: HTMLElement): number | null {
  type Cell = { id:string; table:string; row:number; endRow:number; column:number; columns:number; tag:string; needsContent:boolean };
  const cellsById = new Map<string,Cell>();
  const expected = new Map<string,{table:string;index:number;cells:Cell[]}>();
  source.querySelectorAll<HTMLTableElement>('table[data-preview-table]').forEach(table=>{
    const tableId=table.dataset.previewTable!, occupied:number[]=[];
    Array.from(table.rows).forEach((row,index)=>{
      let column=0;
      const cells=Array.from(row.cells).map(cell=>{
        while(occupied[column]>0)column++;
        const value:Cell={id:cell.dataset.previewCell!,table:tableId,row:index,endRow:index+cell.rowSpan,column,columns:cell.colSpan,tag:cell.tagName,
          needsContent:(!cell.style.verticalAlign||cell.style.verticalAlign==='top') && Boolean(cell.textContent?.trim()||cell.querySelector('img')) && !cell.querySelector('.page-break')};
        for(let c=column;c<column+cell.colSpan;c++)occupied[c]=cell.rowSpan;
        column+=cell.colSpan;cellsById.set(value.id,value);return value;
      });
      for(let c=0;c<occupied.length;c++)occupied[c]=Math.max(0,(occupied[c]||0)-1);
      if(row.parentElement?.tagName!=='THEAD')expected.set(row.dataset.previewRow!,{table:tableId,index,cells});
    });
  });
  const seen=new Set<string>();
  const lastStartedRow=new Map<string,number>();
  for(const [index,page] of Array.from(pages.querySelectorAll('.pagedjs_page')).entries()) {
    // Each physical row group has its own occupied slots. Source IDs/order
    // alone cannot catch a shortened rowspan or missing empty continuation
    // cell shifting all following cells into an earlier column.
    const occupiedByGroup=new Map<Element,number[]>();
    for(const row of page.querySelectorAll<HTMLTableRowElement>('tr')) {
      if(row.closest('[data-repeated-header]')||row.parentElement?.tagName==='THEAD')continue;
      const id=row.dataset.previewRow!, original=expected.get(id);
      if(!original||row.closest('table')?.getAttribute('data-preview-table')!==original.table)return index+1;
      const occupied=occupiedByGroup.get(row.parentElement!)||[];
      const cells=new Map<string,HTMLTableCellElement>();let endColumn=0,physicalColumn=0;
      for(const actual of Array.from(row.cells)) {
        while(occupied[physicalColumn]>0)physicalColumn++;
        const cellId=actual.dataset.previewCell!, cell=cellsById.get(cellId);
        // A continued rowspan may be clamped by pagination or reconstruction.
        // Check its logical ownership/column span rather than its physical height.
        if(!cell||cells.has(cellId)||cell.table!==original.table||cell.row>original.index||cell.endRow<=original.index||
          cell.columns!==actual.colSpan||cell.tag!==actual.tagName||cell.column<endColumn||cell.column!==physicalColumn)return index+1;
        for(let c=physicalColumn;c<physicalColumn+actual.colSpan;c++) {
          if(occupied[c]>0)return index+1;
          occupied[c]=actual.rowSpan||Infinity;
        }
        physicalColumn+=actual.colSpan;
        endColumn=cell.column+cell.columns;cells.set(cellId,actual);
      }
      for(let c=0;c<occupied.length;c++)occupied[c]=Math.max(0,(occupied[c]||0)-1);
      occupiedByGroup.set(row.parentElement!,occupied);
      if(seen.has(id))continue;
      if(original.index<=(lastStartedRow.get(original.table)??-1))return index+1;
      lastStartedRow.set(original.table,original.index);
      seen.add(id);
      if(original.cells.some(cell=>{
        const actual=cells.get(cell.id);
        return !actual || (cell.needsContent && !actual.textContent?.trim() && !actual.querySelector('img'));
      }))return index+1;
    }
  }
  // Empty rows can disappear without affecting text or image counts.
  if([...expected.keys()].some(id=>!seen.has(id)))return Math.max(1,pages.querySelectorAll('.pagedjs_page').length);
  return null;
}
