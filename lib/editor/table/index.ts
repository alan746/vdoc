import { styles } from './styles';
import { TableKit } from '@tiptap/extension-table';
import { VdocTable } from './table-layout';
import { VdocRow, VdocCell, VdocHeader } from './extensions';
import { tableCommands } from './commands';
import { rowPaginationRule, pinnedRowsRule, tableStyleRule, cellBordersRule, cellSpansRule } from './validation';
import { validateTableStructure } from './validate-structure';
import type { EditorFeature } from '../feature';

export const tableFeature = {
  id: 'table',
  blockIdTypes: ['table', 'tableRow', 'tableCell', 'tableHeader'],
  extensions: ({ onResize }) => [
    { order: 1900, value: TableKit.configure({ table: false, tableRow: false, tableCell: false, tableHeader: false }) },
    { order: 2000, value: VdocTable.configure({ resizable: true, cellMinWidth: 40, onResize: onResize ?? null }) },
    { order: 2100, value: VdocRow },
    { order: 2800, value: VdocCell },
    { order: 2900, value: VdocHeader },
  ],
  css: styles,
  commands: tableCommands,
  validation: [{ order: 400, value: rowPaginationRule }, { order: 500, value: pinnedRowsRule }, { order: 520, value: tableStyleRule }, { order: 600, value: cellBordersRule }, { order: 620, value: cellSpansRule }],
  validateDocument: validateTableStructure,
} satisfies EditorFeature;
