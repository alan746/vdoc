/** Work on serialized output, never reparent the live ProseMirror DOM. */
export function preparePrintTables(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const table of doc.querySelectorAll('table')) {
    const rows = Array.from(table.rows);
    const explicit = table.getAttribute('data-pinned-rows');
    let count = explicit !== null && /^\d+$/.test(explicit) ? Math.min(rows.length, Number(explicit)) : 0;
    if (explicit === null) {
      while (count < rows.length && rows[count].cells.length && Array.from(rows[count].cells).every(cell => cell.tagName === 'TH')) count++;
    }
    // Never divide a rowspan across the header/body section boundary.
    for (let i = 0; i < count; i++) for (const cell of rows[i].cells) count = Math.min(rows.length, Math.max(count, i + cell.rowSpan));
    const head = doc.createElement('thead'), body = doc.createElement('tbody');
    rows.forEach((row, i) => (i < count ? head : body).appendChild(row));
    for (const section of Array.from(table.children)) if (['THEAD','TBODY','TFOOT'].includes(section.tagName)) section.remove();
    if (count) table.appendChild(head);
    table.appendChild(body);
    table.setAttribute('data-pinned-rows', String(count));
  }
  return doc.body.innerHTML;
}
