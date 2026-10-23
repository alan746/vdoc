import { CellSelection } from '@tiptap/pm/tables';
import { selectedCellLists } from './cell-lists';
import { numberAffixAttributes } from './list-markers';
import { numberTypeAttribute } from './list-style';
import { OrderedList } from '@tiptap/extension-list';
import type { Node, ResolvedPos } from '@tiptap/pm/model';
import { NodeSelection, Plugin, TextSelection, type Selection, type Transaction } from '@tiptap/pm/state';
import { AddMarkStep, RemoveMarkStep, ReplaceStep } from '@tiptap/pm/transform';

import { validListStart } from '../../domain/rules/list-numbering';
const startOf = (node: Node) => validListStart(node.attrs.start) ? node.attrs.start : 1;
type ListContext = { node: Node; pos: number; itemIndex: number; previous: Node | null };

function atPosition($pos: ResolvedPos): ListContext | null {
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth);
    if (['bulletList', 'taskList', 'tableCell', 'tableHeader'].includes(node.type.name)) return null;
    if (node.type.name !== 'orderedList') continue;
    const parent = $pos.node(depth - 1), index = $pos.index(depth - 1);
    let previous: Node | null = null;
    for (let i = index - 1; i >= 0; i--) if (parent.child(i).type.name === 'orderedList') { previous = parent.child(i); break; }
    return { node, pos: $pos.before(depth), itemIndex: Math.min($pos.index(depth), node.childCount - 1), previous };
  }
  return null;
}

/** Numbering targets one list at one level. Never cross cells or nested lists. */
export function numberedListContext(doc: Node, selection: Selection): ListContext | null {
  if (selection instanceof NodeSelection && selection.node.type.name === 'orderedList') return atPosition(doc.resolve(selection.from + 1));
  if (!(selection instanceof TextSelection)) return null;
  const from = atPosition(selection.$from), to = atPosition(doc.resolve(Math.max(selection.from, selection.to - 1)));
  return from && to && from.pos === to.pos ? from : null;
}

export function canRestartNumbering(doc: Node, selection: Selection): boolean {
  return selection instanceof CellSelection
    ? selectedCellLists(selection).some(({node}) => node.type.name === 'orderedList')
    : numberedListContext(doc, selection) !== null;
}

/** Restart each independent series; preserve linked sections within each selected cell. */
function cellRestartPlan(selection: CellSelection, start: number) {
  const previousEnds = new Map<number, number>();
  const plans: {node: Node; pos: number; start: number; linked: boolean}[] = [];
  for (const {node, pos, parentStart} of selectedCellLists(selection)) {
    if (node.type.name !== 'orderedList') continue;
    const previous = previousEnds.get(parentStart);
    const linked = node.attrs.continuePrevious && previous !== undefined;
    const next = linked ? previous! : start;
    if (!validListStart(next)) return null;
    plans.push({node, pos, start: next, linked});
    previousEnds.set(parentStart, next + node.childCount);
  }
  return plans;
}

export function cellRestartOverflows(selection: Selection, start: number): boolean {
  return selection instanceof CellSelection && validListStart(start) && cellRestartPlan(selection, start) === null;
}

export function continuedStart(context: ListContext): number | null {
  const value = context.itemIndex > 0 ? startOf(context.node) + context.itemIndex : context.previous ? startOf(context.previous) + context.previous.childCount : null;
  return validListStart(value) ? value : null;
}

/** Connect direct numbered lists within each cell, inheriting that cell's first series. */
function cellContinuePlan(selection: CellSelection) {
  const previous = new Map<number, {end: number; attrs: Node['attrs']}>();
  const plans: {node: Node; pos: number; attrs: Node['attrs']}[] = [];
  for (const {node, pos, parentStart} of selectedCellLists(selection)) {
    if (node.type.name !== 'orderedList') continue;
    const source = previous.get(parentStart);
    if (!source) {
      previous.set(parentStart, {end: startOf(node) + node.childCount, attrs: node.attrs});
      continue;
    }
    if (!validListStart(source.end)) return null;
    const attrs = {...node.attrs, start: source.end, continuePrevious: true,
      type: source.attrs.type, numberPrefix: source.attrs.numberPrefix, numberSuffix: source.attrs.numberSuffix};
    plans.push({node, pos, attrs});
    previous.set(parentStart, {end: source.end + node.childCount, attrs});
  }
  return plans;
}

export function canContinueNumbering(doc: Node, selection: Selection): boolean {
  if (selection instanceof CellSelection) return !!cellContinuePlan(selection)?.length;
  const context = numberedListContext(doc, selection);
  return context !== null && continuedStart(context) !== null;
}

export function changeListNumbering(tr: Transaction, mode: 'restart' | 'continue', start?: number): boolean {
  if (tr.selection instanceof CellSelection) {
    if (mode === 'continue') {
      const plans = cellContinuePlan(tr.selection);
      if (!plans?.length) return false;
      for (const {node, pos, attrs} of plans) if (['start','continuePrevious','type','numberPrefix','numberSuffix'].some(key => node.attrs[key] !== attrs[key]))
        tr.setNodeMarkup(pos, undefined, attrs);
      return true;
    }
    if (!validListStart(start)) return false;
    const plans = cellRestartPlan(tr.selection, start);
    if (!plans?.length) return false;
    // Validate every continuation before the first mutation, including overflow.
    for (const plan of plans) if (plan.node.attrs.start !== plan.start || plan.node.attrs.continuePrevious !== plan.linked)
      tr.setNodeMarkup(plan.pos, undefined, {...plan.node.attrs, start: plan.start, continuePrevious: plan.linked});
    return true;
  }
  const context = numberedListContext(tr.doc, tr.selection);
  if (!context) return false;
  const next = mode === 'continue' ? continuedStart(context) : start;
  if (!validListStart(next)) return false;
  const { node, pos, itemIndex } = context;
  const attrs = { ...node.attrs, start: next, continuePrevious: mode === 'continue' };
  if (itemIndex === 0) {
    if (node.attrs.start !== next || node.attrs.continuePrevious !== attrs.continuePrevious) tr.setNodeMarkup(pos, undefined, attrs);
  } else {
    let splitAt = pos + 1;
    for (let i = 0; i < itemIndex; i++) splitAt += node.child(i).nodeSize;
    // Split only the list wrapper. Paragraph IDs, item content, marks and the caret survive.
    tr.split(splitAt, 1, [{ type: node.type, attrs: { ...attrs, blockId: null } }]);
  }
  return true;
}

export const VdocOrderedList = OrderedList.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      type: numberTypeAttribute(),
      ...numberAffixAttributes(),
      start: { default: 1, parseHTML: (el: HTMLElement) => { const value = Number(el.getAttribute('start') ?? 1); return validListStart(value) ? value : 1; } },
      continuePrevious: { default: false, parseHTML: (el: HTMLElement) => el.getAttribute('data-continue-numbering') === 'true', renderHTML: (attrs: Record<string, unknown>) => attrs.continuePrevious ? { 'data-continue-numbering': 'true' } : {} },
    };
  },
  addProseMirrorPlugins() {
    return [...(this.parent?.() || []), new Plugin({
      appendTransaction(transactions, _old, state) {
        if (!transactions.some(t => t.docChanged || t.getMeta('normalizeIds'))) return null;
        // Ordinary typing and marks cannot change the number of list items.
        if (!transactions.some(t => t.getMeta('normalizeIds')) && transactions.every(t => t.steps.every((step, i) => {
          if (step instanceof AddMarkStep || step instanceof RemoveMarkStep) return true;
          if (!(step instanceof ReplaceStep) || !t.docs[i].resolve(step.from).sameParent(t.docs[i].resolve(step.to))) return false;
          let inline = true; step.slice.content.forEach(node => { if (!node.isInline) inline = false; }); return inline;
        }))) return null;
        const tr = state.tr;
        const visit = (parent: Node, base: number) => {
          let previousEnd: number | null = null;
          let previousType: string | null = null;
          let previousPrefix = '', previousSuffix = '.';
          parent.forEach((node, offset) => {
            const pos = base + offset;
            if (node.type.name === 'orderedList') {
              const start = node.attrs.continuePrevious && validListStart(previousEnd) ? previousEnd : startOf(node);
              const type = node.attrs.continuePrevious && previousEnd !== null ? previousType : node.attrs.type;
              const numberPrefix = node.attrs.continuePrevious && previousEnd !== null ? previousPrefix : node.attrs.numberPrefix;
              const numberSuffix = node.attrs.continuePrevious && previousEnd !== null ? previousSuffix : node.attrs.numberSuffix;
              if (start !== node.attrs.start || type !== node.attrs.type || numberPrefix !== node.attrs.numberPrefix || numberSuffix !== node.attrs.numberSuffix) tr.setNodeMarkup(pos, undefined, { ...node.attrs, start, type, numberPrefix, numberSuffix });
              previousPrefix = numberPrefix; previousSuffix = numberSuffix;
              previousType = type;
              previousEnd = start + node.childCount;
            }
            if (!node.isLeaf && !node.isTextblock) visit(node, pos + 1);
          });
        };
        visit(state.doc, 0);
        return tr.docChanged ? tr.setMeta('addToHistory', false) : null;
      },
    })];
  },
});
