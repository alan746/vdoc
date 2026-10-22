import { previewTextMatches } from './paged-preview';

/** Build one disposable reflow source from repaired table fragments. The saved
 * table is never changed. Already split paragraphs remain atomic row pieces. */
export function compactPreviewTables(source: HTMLElement, pages: HTMLElement): string | null {
  const result=source.cloneNode(true) as HTMLElement;
  let changed=false;
  for(const original of source.querySelectorAll<HTMLTableElement>('table[data-preview-table]')) {
    const id=original.dataset.previewTable;
    const fragments=Array.from(pages.querySelectorAll<HTMLTableElement>('table[data-preview-table]')).filter(table=>table.dataset.previewTable===id);
    if(!fragments.some(table=>table.dataset.previewRepaired==='true'))continue;
    // Nested tables and explicit row heights need a separate fragmentation policy.
    if(original.parentElement?.closest('table')||original.querySelector('table,.page-break,ul,ol,pre')||Array.from(original.rows).some(row=>row.style.height||row.style.minHeight))continue;
    const target=Array.from(result.querySelectorAll<HTMLTableElement>('table[data-preview-table]')).find(table=>table.dataset.previewTable===id)!;
    const columns=new Map<string|undefined,{start:number;span:number}>();
    const sourceOccupied:number[]=[];let width=0;
    Array.from(original.rows).forEach(row=>{
      let column=0;
      for(const cell of Array.from(row.cells)) {
        while(sourceOccupied[column]>0)column++;
        columns.set(cell.dataset.previewCell,{start:column,span:cell.colSpan});
        for(let c=column;c<column+cell.colSpan;c++)sourceOccupied[c]=cell.rowSpan;
        column+=cell.colSpan;width=Math.max(width,column);
      }
      for(let c=0;c<sourceOccupied.length;c++)sourceOccupied[c]=Math.max(0,(sourceOccupied[c]||0)-1);
    });
    const body=document.createElement('tbody');
    const sourceRows=new Map(Array.from(original.rows).map(row=>[row.dataset.previewRow,row]));
    const counts=new Map<string|undefined,number>();
    fragments.forEach(table=>Array.from(table.rows).filter(row=>row.parentElement?.tagName!=='THEAD').forEach(row=>counts.set(row.dataset.previewRow,(counts.get(row.dataset.previewRow)||0)+1)));
    for(const fragment of fragments) {
      const rows=Array.from(fragment.rows).filter(row=>row.parentElement?.tagName!=='THEAD');
      const keep=rows.map(row=>Boolean(row.textContent?.trim()||row.querySelector('p,h1,h2,h3,h4,h5,h6,pre,img,hr,ul,ol,table,input')));
      const output=rows.map(row=>{const clone=row.cloneNode(false) as HTMLTableRowElement;clone.setAttribute('style',sourceRows.get(row.dataset.previewRow)?.getAttribute('style')||'');return clone;});

      const anchors:{cell:HTMLTableCellElement;row:number;column:number;span:number}[]=[];
      rows.forEach((row,index)=>{
        for(const cell of Array.from(row.cells)) {
          const location=columns.get(cell.dataset.previewCell);
          if(!location||location.span!==cell.colSpan)throw new Error('Table columns could not be preserved while compacting the preview.');
          const column=location.start;
          const span=Math.min(cell.rowSpan||rows.length-index,rows.length-index);
          anchors.push({cell,row:index,column,span});
        }
      });
      const placed=rows.map(()=>[] as {column:number;cell:HTMLTableCellElement}[]);
      for(const anchor of anchors) {
        const survivors=rows.map((_,i)=>i).filter(i=>i>=anchor.row&&i<anchor.row+anchor.span&&keep[i]);
        if(!survivors.length)continue;
        const cell=anchor.cell.cloneNode(true) as HTMLTableCellElement;
        cell.rowSpan=survivors.length;
        // Freeze only fragment spacing, not row height. Paged.js split selectors
        // will no longer apply after generated identity attributes are removed.
        const originals=[anchor.cell,...anchor.cell.querySelectorAll<HTMLElement>('p,h1,h2,h3,h4,h5,h6')];
        const clones=[cell,...cell.querySelectorAll<HTMLElement>('p,h1,h2,h3,h4,h5,h6')];
        originals.forEach((node,i)=>{
          const css=getComputedStyle(node);
          for(const property of ['padding-top','padding-bottom','margin-top','margin-bottom']) {
            const value=css.getPropertyValue(property);if(value)clones[i].style.setProperty(property,value,'important');
          }
        });
        placed[survivors[0]].push({column:anchor.column,cell});
      }
      const occupied:number[]=[];
      rows.forEach((_,i)=>{
        if(!keep[i])return;
        for(const {column,cell} of placed[i])for(let c=column;c<column+cell.colSpan;c++) {
          if(occupied[c]>0)throw new Error('Table columns could not be preserved while compacting the preview.');
          occupied[c]=cell.rowSpan;
        }
        if(Array.from({length:width},(_,c)=>occupied[c]||0).some(span=>!span))throw new Error('Table columns could not be preserved while compacting the preview.');
        for(let c=0;c<occupied.length;c++)occupied[c]=Math.max(0,(occupied[c]||0)-1);
      });
      rows.forEach((_,i)=>{if(keep[i]){placed[i].sort((a,b)=>a.column-b.column).forEach(({cell})=>output[i].appendChild(cell));body.appendChild(output[i]);}});
    }
    // A vacated continuation can now sit immediately under the real content
    // of the same logical merged cell. Join it back instead of drawing a new
    // horizontal grid edge through the original rowspan.
    const last=new Map<string|undefined,{cell:HTMLTableCellElement;end:number}>();
    Array.from(body.rows).forEach((row,index)=>{
      for(const cell of Array.from(row.cells)) {
        const previous=last.get(cell.dataset.previewCell);
        if(previous&&previous.end===index&&previous.cell.parentElement?.getAttribute('data-preview-row')!==row.dataset.previewRow&&!cell.textContent?.trim()&&!cell.children.length) {
          previous.cell.rowSpan+=cell.rowSpan;previous.end=index+cell.rowSpan;cell.remove();
        } else last.set(cell.dataset.previewCell,{cell,end:index+cell.rowSpan});
      }
    });
    // Compare against the validated repaired stream, whose first occurrence
    // order can differ from the original after parallel cell relocation.
    const before=document.createElement('div');fragments.forEach(table=>before.appendChild(table.cloneNode(true)));
    target.querySelectorAll(':scope > tbody,:scope > tr').forEach(node=>node.remove());target.appendChild(body);
    for(const node of [target,...target.querySelectorAll('*')]) {
      for(const name of node.getAttributeNames()) {
        if(name==='data-ref'||name==='data-id'||name.startsWith('data-split-')||name.startsWith('data-break-')||name.startsWith('data-next-break-')||name==='data-preview-repaired')node.removeAttribute(name);
      }
    }
    for(const row of Array.from(body.rows)) {
      if((counts.get(row.dataset.previewRow)||0)>1) {
        row.style.breakInside='avoid';row.style.pageBreakInside='avoid';
        row.dataset.breakBefore='page';row.previousElementSibling?.setAttribute('data-next-break-before','page');
        Array.from(row.cells).forEach(cell=>{cell.style.breakInside='avoid';});
      }
    }
    const after=document.createElement('div');after.appendChild(target.cloneNode(true));
    if(!previewTextMatches(before,after))throw new Error('Table content could not be preserved while compacting the preview. Return to editing or export Word instead.');
    changed=true;
  }
  return changed?result.innerHTML:null;
}
