import { Extension, getNodeType, type CommandProps, type Editor } from '@tiptap/core';
import { Fragment, NodeRange, Slice, type Node, type NodeType, type ResolvedPos } from '@tiptap/pm/model';
import { validListStart } from '../../domain/rules/list-numbering';
import { liftCellLists, selectedCellLists } from './cell-lists';
import { CellSelection } from '@tiptap/pm/tables';
import { selectedParagraphs } from '../paragraph/paragraph-selection';
import { paragraphIndent, stepParagraphIndent } from '../paragraph/paragraph-indent';
import { EditorState, TextSelection, type Selection, type Transaction } from '@tiptap/pm/state';
import { liftTarget, ReplaceAroundStep } from '@tiptap/pm/transform';
import { liftListItem, sinkListItem } from '@tiptap/pm/schema-list';
import { promotedItemContent } from './promote-items';

function itemAt($pos: ResolvedPos) {
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth);
    // A list outside a cell must never capture an operation on cell contents.
    if (['tableCell', 'tableHeader'].includes(node.type.name)) return null;
    if (['listItem', 'taskItem'].includes(node.type.name)) return { type: node.type, listPos: $pos.before(depth - 1) };
  }
  return null;
}

/** Only the nearest list, at one level, owns this selection. */
export function selectedListItemType(selection: Selection): NodeType | null {
  if (!(selection instanceof TextSelection)) return null;
  const from = itemAt(selection.$from);
  const to = itemAt(selection.$to.doc.resolve(Math.max(selection.from, selection.to - 1)));
  return from && to && from.listPos === to.listPos ? from.type : null;
}

/** Do not turn an unsupported list selection into paragraph-only indentation. */
export function indentCommandType(selection: Selection, direction: 'in' | 'out' = 'in'): 'list.indent' | 'paragraph.indent' | null {
  if (selectedCellLists(selection).length) return direction === 'out' ? 'list.indent' : null;
  if (selectedListItemType(selection)) return 'list.indent';
  if (selection instanceof TextSelection &&
      (itemAt(selection.$from) || itemAt(selection.$to.doc.resolve(Math.max(selection.from, selection.to - 1))))) return null;
  let containsList = false;
  for (const {$from,$to} of selection.ranges) $from.doc.nodesBetween($from.pos,$to.pos,(node,pos)=>{
    if (pos >= $from.pos && pos < $to.pos && ['orderedList','bulletList','taskList'].includes(node.type.name)) containsList = true;
  });
  return containsList ? null : 'paragraph.indent';
}

/** Shared, read-only capability check for menus and keyboard commands. */
export function availableIndentCommand(editor: Editor, direction: 'in' | 'out') {
  if (editor.isDestroyed || !editor.isEditable || editor.view.composing) return null;
  const {state} = editor, command = indentCommandType(state.selection, direction);
  if (command === 'paragraph.indent') {
    return selectedParagraphs(state.doc, state.selection).some(({node}) => {
      const current = paragraphIndent(node.attrs).indentStart;
      return stepParagraphIndent(current, direction) !== current;
    }) ? command : null;
  }
  if (command !== 'list.indent') return null;
  if (state.selection instanceof CellSelection) return liftCellLists(state.tr, false) ? command : null;
  const type = selectedListItemType(state.selection);
  return type && (direction === 'in' ? editor.can().sinkListItem(type) : editor.can().liftListItem(type)) ? command : null;
}

/** Plan the structural lift separately so a failed native command cannot partially write. */
function liftNestedItems(tr: Transaction, range: NodeRange, itemType: NodeType, write: boolean): boolean {
  const source = range.parent, endOfList = range.$to.end(range.depth);
  const hasTail = range.end < endOfList;
  const tailStart = source.type.name === 'orderedList' ? source.attrs.start + range.startIndex : null;
  if (hasTail && tailStart !== null && !validListStart(tailStart)) return false;
  const draft = EditorState.create({doc:tr.doc,selection:tr.selection}).tr;
  if (hasTail) {
    const attrs = {...source.attrs, blockId:null, ...(tailStart !== null ? {start:tailStart,continuePrevious:false} : {})};
    const tail = source.type.create(attrs);
    // Following siblings remain children of the last lifted item, as a separate list.
    draft.step(new ReplaceAroundStep(range.end-1,endOfList,range.end,endOfList,
      new Slice(Fragment.from(itemType.create(null,tail)),1,0),1,true));
    range = new NodeRange(draft.doc.resolve(range.$from.pos),draft.doc.resolve(endOfList),range.depth);
  }
  const target = liftTarget(range);
  if (target === null) return false;
  draft.lift(range,target);
  // Keep the item's own child list and the remaining siblings independent, even
  // when they share a node type. Joining them loses counters, markers or task modes.
  if (write) for (const step of draft.steps) tr.step(step);
  return true;
}

/** Unwrapping a root list changes the parent of its child lists. Keep each
 * numbering series attached to its original source, not a newly adjacent list. */
function liftRootItems(tr: Transaction, range: NodeRange, itemType: NodeType, write: boolean): boolean {
  const source = range.parent, parentDepth = range.depth - 1;
  const parent = range.$from.node(parentDepth), index = range.$from.index(parentDepth);
  const promoted: Node[] = [];
  for (let i = range.startIndex; i < range.endIndex; i++) promoted.push(...promotedItemContent(source.child(i)));
  const hasPromotedNumbering = promoted.some(n => n.type.name === 'orderedList');
  const head = range.startIndex > 0, tail = range.endIndex < source.childCount;
  const output: Node[] = [];
  let nextNumbered = true;
  for (let i = 0; i < parent.childCount; i++) {
    const node = parent.child(i);
    if (i === index) {
      if (head) output.push(source.copy(Fragment.fromArray(source.content.content.slice(0, range.startIndex))));
      output.push(...promoted);
      if (tail) {
        const start = source.attrs.start + range.startIndex;
        if (source.type.name === 'orderedList' && !validListStart(start)) return false;
        output.push(source.type.create({...source.attrs, ...(head ? {blockId:null} : {}),
          ...(source.type.name === 'orderedList' ? {start, continuePrevious: !hasPromotedNumbering && (head || source.attrs.continuePrevious)} : {})},
          Fragment.fromArray(source.content.content.slice(range.endIndex))));
      }
    } else if (i > index && node.type.name === 'orderedList' && nextNumbered) {
      nextNumbered = false;
      if (node.attrs.continuePrevious) {
        const start = source.type.name === 'orderedList'
          ? source.attrs.start + source.childCount - (range.endIndex - range.startIndex) : node.attrs.start;
        if (!validListStart(start)) return false;
        const linked = source.type.name === 'orderedList'
          ? tail || (head && !hasPromotedNumbering) : !hasPromotedNumbering;
        output.push(node.type.create({...node.attrs, start, continuePrevious:linked}, node.content, node.marks));
      } else output.push(node);
    } else output.push(node);
  }
  // Resolve surviving chains now, so later operations in the same batch see
  // their final starts and marker styles without waiting for appendTransaction.
  let previousNumbered: (typeof output)[number] | null = null;
  for (let i = 0; i < output.length; i++) {
    let node = output[i];
    if (node.type.name !== 'orderedList') continue;
    if (node.attrs.continuePrevious && previousNumbered) {
      const start = previousNumbered.attrs.start + previousNumbered.childCount;
      if (!validListStart(start)) return false;
      node = output[i] = node.type.create({...node.attrs, start, type:previousNumbered.attrs.type,
        numberPrefix:previousNumbered.attrs.numberPrefix, numberSuffix:previousNumbered.attrs.numberSuffix}, node.content, node.marks);
    }
    previousNumbered = node;
  }
  const draftState = EditorState.create({doc:tr.doc, selection:tr.selection});
  let draft: Transaction | undefined;
  if (!liftListItem(itemType)(draftState, transaction => { draft = transaction; }) || !draft) return false;
  const planned = draft as Transaction;
  const base = planned.mapping.map(range.$from.start(parentDepth), -1);
  const resultParent = planned.doc.resolve(base).node(parentDepth);
  if (resultParent.childCount !== output.length) return false;
  resultParent.forEach((node, offset, childIndex) => {
    const expected = output[childIndex];
    if (node.type.name === 'orderedList' && Object.keys(expected.attrs).some(key => node.attrs[key] !== expected.attrs[key]))
      planned.setNodeMarkup(base + offset, undefined, expected.attrs);
  });
  if (write) for (const step of planned.steps) tr.step(step);
  return true;
}

function editList(typeOrName: string | NodeType, direction: 'in' | 'out', props: CommandProps): boolean {
  const { state, dispatch, editor, tr } = props;
  const type = getNodeType(typeOrName, state.schema);
  if (editor.view.composing || selectedListItemType(state.selection) !== type) return false;
  const { $from, $to } = state.selection;
  const range = $from.blockRange($to, node => node.childCount > 0 && node.firstChild!.type === type);
  if (!range) return false;
  if (direction === 'out' && $from.node(range.depth - 1).type === type) {
    const ok = liftNestedItems(tr, range, type, !!dispatch);
    if (ok && dispatch) dispatch(tr.scrollIntoView());
    return ok;
  }
  if (direction === 'out') {
    const ok = liftRootItems(tr, range, type, !!dispatch);
    if (ok && dispatch) dispatch(tr.scrollIntoView());
    return ok;
  }
  const source = range.parent;
  const existingDestination = range.startIndex > 0 && source.child(range.startIndex - 1).lastChild?.type === source.type;
  return sinkListItem(type)(state, dispatch && (transaction => {
    if (!existingDestination) {
      const target = itemAt(transaction.selection.$from);
      if (target) {
        const node = transaction.doc.nodeAt(target.listPos)!;
        // A new level inherits the marker, but has its own identity and counter.
        transaction.setNodeMarkup(target.listPos, undefined, {
          ...node.attrs, ...source.attrs, blockId: null,
          ...(source.type.name === 'orderedList' ? { start: 1, continuePrevious: false } : {}),
        });
      }
    }
    dispatch(transaction);
  }));
}

// Commands are collected in priority order; run after core's default commands.
// Native list keymaps and the operation engine both use these same commands.
export const ListEditing = Extension.create({
  name: 'vdocListEditing',
  priority: 90,
  addCommands() {
    return {
      sinkListItem: type => props => editList(type, 'in', props),
      liftListItem: type => props => editList(type, 'out', props),
    };
  },
});
