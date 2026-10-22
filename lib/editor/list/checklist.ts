import { CellSelection } from '@tiptap/pm/tables';
import { selectedCellLists } from './cell-lists';
import { TaskList } from '@tiptap/extension-list';
import type { Node, ResolvedPos } from '@tiptap/pm/model';
import { NodeSelection, TextSelection, type Selection, type Transaction } from '@tiptap/pm/state';

export const VdocTaskList = TaskList.extend({
  addAttributes() {
    return { ...this.parent?.(), strikeCompleted: {
      default: true,
      parseHTML: (el: HTMLElement) => el.getAttribute('data-strike-completed') !== 'false',
      renderHTML: (attrs: Record<string, unknown>) => ({ 'data-strike-completed': String(attrs.strikeCompleted !== false) }),
    } };
  },
});
function at($pos: ResolvedPos) {
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth);
    if (['orderedList','bulletList','tableCell','tableHeader'].includes(node.type.name)) return null;
    if (node.type.name === 'taskList') return {node, pos:$pos.before(depth)};
  }
  return null;
}
export function checklistContext(doc: Node, selection: Selection) {
  if (selection instanceof NodeSelection && selection.node.type.name === 'taskList') return {node:selection.node,pos:selection.from};
  if (!(selection instanceof TextSelection)) return null;
  const from = at(selection.$from), to = at(doc.resolve(Math.max(selection.from,selection.to-1)));
  return from && to && from.pos === to.pos ? from : null;
}
export function checklistTargets(doc: Node, selection: Selection) {
  if (selection instanceof CellSelection) return selectedCellLists(selection).filter(({node}) => node.type.name === 'taskList');
  const context = checklistContext(doc, selection);
  return context ? [context] : [];
}
export function changeChecklistStyle(tr: Transaction, strikeCompleted: boolean): boolean {
  const targets = checklistTargets(tr.doc,tr.selection);
  if (!targets.length) return false;
  for (const {node,pos} of targets) if (node.attrs.strikeCompleted !== strikeCompleted) tr.setNodeMarkup(pos,undefined,{...node.attrs,strikeCompleted});
  return true;
}
