import { Table, TableView, createColGroup, type TableOptions } from '@tiptap/extension-table';
import { tableEditing } from '@tiptap/pm/tables';
import { rtlTableNavigation } from './table-direction';
import { tableHeadersPlugin } from './table-headers';
import { tableResizePlugin, type CommitTableResize } from './table-resize';
import { mergeAttributes } from '@tiptap/core';
import type { Node as ProseMirrorNode, DOMOutputSpec } from '@tiptap/pm/model';

function margins(alignment: string) {
  return { left: alignment === 'left' ? '0px' : 'auto', right: alignment === 'right' ? '0px' : 'auto' };
}

/** Resizable tables use a NodeView, so serialized attributes alone are insufficient. */
class AlignedTableView extends TableView {
  constructor(...args: ConstructorParameters<typeof TableView>) {
    super(...args);
    this.align();
  }
  private align() {
    const alignment = this.node.attrs.alignment || 'left', margin = margins(alignment);
    this.table.dataset.tableAlign = alignment;
    this.table.dir = this.node.attrs.columnDirection || 'ltr';
    this.dom.style.direction = 'ltr';
    if (this.node.attrs.pinnedRows == null) delete this.table.dataset.pinnedRows;
    else this.table.dataset.pinnedRows = String(this.node.attrs.pinnedRows);
    this.table.style.marginLeft = margin.left;
    this.table.style.marginRight = margin.right;
  }
  update(node: ProseMirrorNode) {
    if (!super.update(node)) return false;
    this.align();
    return true;
  }
}

export const VdocTable = Table.extend<TableOptions & { onResize: CommitTableResize | null }>({
  addAttributes() {
    return { ...this.parent?.(), columnDirection: {
      default: 'ltr',
      parseHTML: el => (el.getAttribute('dir') || el.style.direction) === 'rtl' ? 'rtl' : 'ltr',
      renderHTML: attrs => ({ dir: attrs.columnDirection }),
    }, alignment: {
      default: 'left',
      parseHTML: el => {
        const explicit = el.getAttribute('data-table-align') || el.getAttribute('align');
        if (explicit && ['left','center','right'].includes(explicit)) return explicit;
        if (el.style.marginLeft === 'auto') return el.style.marginRight === 'auto' ? 'center' : 'right';
        return 'left';
      },
      renderHTML: attrs => ({ 'data-table-align': attrs.alignment }),
    }, pinnedRows: {
      default: null,
      parseHTML: el => { const value = el.getAttribute('data-pinned-rows'); return value !== null && /^\d+$/.test(value) ? Math.min(Number(value), el.querySelectorAll(':scope > tbody > tr, :scope > thead > tr, :scope > tr').length) : null; },
      renderHTML: attrs => attrs.pinnedRows === null ? {} : { 'data-pinned-rows': attrs.pinnedRows },
    } };
  },
  addOptions() { return { ...this.parent!(), View: AlignedTableView, onResize: null }; },
  addNodeView() {
    return ({ node, view, HTMLAttributes }) => new AlignedTableView(node, this.options.cellMinWidth, view, mergeAttributes(this.options.HTMLAttributes, HTMLAttributes));
  },
  addProseMirrorPlugins() {
    return [
      rtlTableNavigation(),
      tableHeadersPlugin(),
      ...(this.options.onResize ? [tableResizePlugin(this.options.onResize)] : []),
      tableEditing({ allowTableNodeSelection: this.options.allowTableNodeSelection }),
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    const { colgroup, tableWidth, tableMinWidth } = createColGroup(node, this.options.cellMinWidth);
    const margin = margins(node.attrs.alignment || 'left');
    const style = `${tableWidth ? `width:${tableWidth}` : `min-width:${tableMinWidth}`};margin-left:${margin.left};margin-right:${margin.right}`;
    const table: DOMOutputSpec = ['table', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { style }), colgroup, ['tbody', 0]];
    return this.options.renderWrapper ? ['div', { class: 'tableWrapper' }, table] : table;
  },
});
