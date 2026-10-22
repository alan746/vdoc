/** Repair a Paged.js row fragment only when its delayed siblings can be moved
 * intact without changing measured row geometry. Complete sequences of paragraph
 * fragments can move together; no new text splits or saved-document edits occur. */
export function repairPreviewTableRows(source: HTMLElement, pages: HTMLElement): string[] {
  const fragments=new Map<string,HTMLElement[]>();
  pages.querySelectorAll<HTMLElement>('tr[data-preview-row]').forEach(row=>{
    if(row.closest('[data-repeated-header]')||row.parentElement?.tagName==='THEAD')return;
    const id=row.dataset.previewRow!;fragments.set(id,[...(fragments.get(id)||[]),row]);
  });
  const retry:string[]=[];
  const hasContent=(cell:Element)=>Boolean(cell.textContent?.trim()||cell.querySelector('img'));
  const ownCells=(row:Element)=>Array.from(row.children).filter(cell=>cell.matches('td,th')) as HTMLElement[];
  source.querySelectorAll<HTMLElement>('tr[data-preview-row]').forEach(original=>{
    const rows=fragments.get(original.dataset.previewRow!);if(!rows||rows.length<2)return;
    const first=rows[0];
    const candidates:{copies:HTMLElement[]; chunks:ChildNode[][]; snapshots:ChildNode[][]; styles:(string|null)[]; padding:{top:string;bottom:string}[]}[]=[];
    for(const cell of ownCells(original)) {
      if(!hasContent(cell)||!['','top'].includes(cell.style.verticalAlign)||cell.querySelector('.page-break,table'))continue;
      const copies=rows.flatMap(row=>ownCells(row).filter(copy=>copy.dataset.previewCell===cell.dataset.previewCell));
      const target=copies.find(copy=>copy.parentElement===first);
      const donors=copies.filter(hasContent);
      if(!target||hasContent(target)||!donors.length)continue;
      // Accept a complete stream, not a partial/duplicated late fragment. Keep
      // each existing page fragment intact so marks, bidi and graphemes survive.
      const images=(elements:Element[])=>elements.flatMap(element=>Array.from(element.querySelectorAll('img')).map(img=>img.getAttribute('src')));
      if(donors.map(donor=>donor.textContent).join('')!==cell.textContent||JSON.stringify(images(donors))!==JSON.stringify(images([cell])))continue;
      if(donors.length>1) {
        // Only direct paragraph/heading fragments are supported. Lists, nested
        // objects require their own layout; existing paragraph splits stay intact.
        const paragraphs=Array.from(cell.children);
        if(!paragraphs.length||paragraphs.some(node=>!node.matches('p,h1,h2,h3,h4,h5,h6')))continue;
        const ids=paragraphs.map(node=>node.getAttribute('data-preview-block'));
        if(ids.some(id=>!id))continue;
        const parts=donors.flatMap(donor=>Array.from(donor.children));
        if(parts.some(node=>!node.matches('p,h1,h2,h3,h4,h5,h6')))continue;
        const sequence=parts.map(node=>node.getAttribute('data-preview-block')).filter((id,index,all)=>index===0||id!==all[index-1]);
        if(JSON.stringify(sequence)!==JSON.stringify(ids))continue;
      }
      candidates.push({copies,chunks:donors.map(donor=>Array.from(donor.childNodes)),snapshots:copies.map(copy=>Array.from(copy.childNodes)),styles:copies.map(copy=>copy.getAttribute('style')),padding:donors.map(donor=>{const css=getComputedStyle(donor);return {top:css.paddingTop,bottom:css.paddingBottom};})});
    }
    if(!candidates.length)return;
    const related=new Set(rows.flatMap(row=>Array.from(row.closest('table')?.querySelectorAll<HTMLElement>('tr')||[])));
    const measured=Array.from(related).map(row=>({row,rect:row.getBoundingClientRect(),style:row.getAttribute('style')}));
    const available=candidates.map(({copies,chunks})=>copies.slice(0,chunks.length).map(copy=>copy.getBoundingClientRect()));
    // Emptying a donor otherwise redistributes the height of its rowspan group.
    // Retain every measured row in both fragments, including sibling rows.
    measured.forEach(({row,rect})=>{row.style.height=`${rect.height}px`;});
    candidates.forEach(({copies,chunks,padding})=>{
      copies.forEach(copy=>copy.replaceChildren());
      chunks.forEach((nodes,index)=>{
        copies[index].replaceChildren(...nodes);
        // Paged.js removes padding at split cell edges. Preserve that space
        // budget when transferring a continuation, or a full-height fragment
        // gains padding and forces a new (horizontal) CSS column.
        if(chunks.length>1) {
          copies[index].style.setProperty('padding-top',padding[index].top,'important');
          copies[index].style.setProperty('padding-bottom',padding[index].bottom,'important');
        }
      });
    });
    const unchanged=measured.every(({row,rect})=>{
      const after=row.getBoundingClientRect();return rect.width>0&&rect.height>0&&Math.abs(after.height-rect.height)<.5&&Math.abs(after.width-rect.width)<.5;
    });
    const fits=candidates.every(({copies,chunks},candidateIndex)=>chunks.every((_,index)=>{
      const bounds=available[candidateIndex][index];
      return Array.from(copies[index].children).every(child=>{
        const rect=child.getBoundingClientRect();return rect.left>=bounds.left-1&&rect.right<=bounds.right+1&&rect.top>=bounds.top-1&&rect.bottom<=bounds.bottom+1;
      });
    }));
    if(!unchanged||!fits) {
      candidates.forEach(({copies,snapshots,styles})=>{copies.forEach(copy=>copy.replaceChildren());copies.forEach((copy,index)=>{copy.replaceChildren(...snapshots[index]);if(styles[index]===null)copy.removeAttribute('style');else copy.setAttribute('style',styles[index]!);});});
      measured.forEach(({row,style})=>{if(style===null)row.removeAttribute('style');else row.setAttribute('style',style);});
      retry.push(original.dataset.previewRow!);
    } else {
      rows.forEach(row=>{const table=row.closest('table');if(table)table.dataset.previewRepaired='true';});
    }
  });
  return retry;
}
/** Retry in a disposable source copy, never changing saved paragraph/table data. */
export function startPreviewRowsOnNewPage(html:string, rows:string[]):string {
  const root=document.createElement('div');root.innerHTML=html;const ids=new Set(rows);
  root.querySelectorAll<HTMLElement>('tr[data-preview-row]').forEach(row=>{
    if(ids.has(row.dataset.previewRow!)) {
      row.style.setProperty('break-before','page');row.style.setProperty('page-break-before','always');
      // Paged.js consumes break metadata; inline declarations are not passed
      // through its stylesheet parser.
      row.dataset.breakBefore='page';
      row.previousElementSibling?.setAttribute('data-next-break-before','page');
    }
  });
  return root.innerHTML;
}
