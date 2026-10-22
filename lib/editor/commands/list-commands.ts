import { changeChecklistStyle } from '../list/checklist';
import { selectedListItemType } from '../list/list-editing';
import { liftCellLists } from '../list/cell-lists';
import { changeListStyle, changeListMarker } from '../list/list-style';
import { changeListNumbering } from '../list/list-numbering';
import { CellSelection } from '@tiptap/pm/tables';
import type { HandlerMap } from './types';

/** List and checklist operations. */
export const listCommands = {
  'list.checklistStyle': (op, { state }) => changeChecklistStyle(state.tr, op.strikeCompleted),
  'list.marker': (op, { state }) => changeListMarker(state.tr, op),
  'list.style': (op, { state }) => changeListStyle(state.tr, op.style),
  'list.restart': (op, { state }) => changeListNumbering(state.tr, 'restart', op.start),
  'list.continue': (_op, { state }) => changeListNumbering(state.tr, 'continue'),
  'list.toggle': (op, { c }) => op.kind === 'bullet' ? c.toggleBulletList() : op.kind === 'task' ? c.toggleTaskList() : c.toggleOrderedList(),
  'list.indent': (op, { state, c }) => {
    if (state.selection instanceof CellSelection) return op.direction === 'out' && liftCellLists(state.tr);
    const type = selectedListItemType(state.selection);
    return !!type && (op.direction === 'in' ? c.sinkListItem(type) : c.liftListItem(type));
  },
} satisfies HandlerMap<'list.checklistStyle' | 'list.marker' | 'list.style' | 'list.restart' | 'list.continue' | 'list.toggle' | 'list.indent'>;
