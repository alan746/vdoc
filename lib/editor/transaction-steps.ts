import type { Node, Slice } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import { AddMarkStep, RemoveMarkStep, ReplaceStep, type Step } from '@tiptap/pm/transform';
import { UserTextReplace } from './document/preserving-replace';

/** Adds or removes a mark without changing document structure. */
export const isMarkStep = (step: Step) => step instanceof AddMarkStep || step instanceof RemoveMarkStep;

/** The replaced range and inserted slice of a plain replace step, including
 *  user text input (UserTextReplace wraps a ReplaceStep without extending it). */
export function replaceOf(step: Step): { from: number; to: number; slice: Slice } | null {
  return step instanceof ReplaceStep || step instanceof UserTextReplace ? { from: step.from, to: step.to, slice: step.slice } : null;
}

/** Ordinary typing: a replacement inside one textblock that inserts only inline content. `doc` is the document before the step. */
export function isInlineReplace(step: Step, doc: Node) {
  const replace = replaceOf(step);
  if (!replace) return false;
  // The shared parent must be the textblock itself: deleting whole rows or list
  // items also keeps both ends in one parent (the table or list), with an
  // empty slice, but it removes blocks.
  const $from = doc.resolve(replace.from);
  if (!$from.parent.isTextblock || !$from.sameParent(doc.resolve(replace.to))) return false;
  let inline = true;
  replace.slice.content.forEach(node => { if (!node.isInline) inline = false; });
  return inline;
}

/** Ordinary typing or a mark change: it cannot add, remove, move or restructure blocks.
 *  Plugins with a wider notion of "harmless" compose their own predicate from this one. */
export const isTypingStep = (step: Step, docBefore: Node) => isMarkStep(step) || isInlineReplace(step, docBefore);

/** Every step of every transaction satisfies `predicate`, given the document before that step. */
export function everyStep(transactions: readonly Transaction[], predicate: (step: Step, docBefore: Node) => boolean): boolean {
  return transactions.every(transaction => transaction.steps.every((step, index) => predicate(step, transaction.docs[index])));
}
