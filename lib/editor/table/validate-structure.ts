import type { Node } from '@tiptap/pm/model';
import { TableMap } from '@tiptap/pm/tables';
import { completePinnedBoundary } from './table-headers';

export function validateTableStructure(document: Node) {
  document.descendants(table => {
    if (table.type.name !== 'table') return;
    // Node.check validates cell attributes/content, not the occupied grid. Do
    // not let the editor silently repair a damaged backup or saved version.
    // Legacy partial column widths are layout hints, not missing/overlapping cells.
    if (TableMap.get(table).problems?.some(problem => problem.type !== 'colwidth mismatch')) throw new Error('The document contains an invalid table structure. Cells are missing, overlapping, or extend beyond the table.');
    if (table.attrs.pinnedRows != null && completePinnedBoundary(table, table.attrs.pinnedRows) !== table.attrs.pinnedRows) throw new Error('The pinned header boundary splits a merged cell.');
  });
}
