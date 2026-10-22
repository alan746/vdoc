// Keep the serialized export's horizontal layout and detached preview sizing
// in one place. A detached DOM has no computed styles to measure.
export const printContainerLayout = {
  listPadding: 24,
  itemPadding: 5,
  taskLabel: 20,
  taskGap: 9,
  quoteMargin: 40,
  quotePadding: 16,
  quoteBorder: 3,
} as const;

/** Width inside ancestors between a table and its page or owning table cell. */
export function printContainerWidth(table: HTMLTableElement, boundary: HTMLElement, width: number) {
  const p = printContainerLayout;
  for (let ancestor = table.parentElement; ancestor && ancestor !== boundary; ancestor = ancestor.parentElement) {
    if (ancestor.matches('ul,ol') && !ancestor.matches('ul[data-type="taskList"]')) width -= p.listPadding;
    if (ancestor.tagName === 'LI') width -= ancestor.parentElement?.matches('ul[data-type="taskList"]') ? p.taskLabel + p.taskGap : p.itemPadding;
    if (ancestor.tagName === 'BLOCKQUOTE') width -= 2 * p.quoteMargin + p.quotePadding + p.quoteBorder;
  }
  return Math.max(1, width);
}
