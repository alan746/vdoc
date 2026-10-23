import type { Node } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import { AddMarkStep, RemoveMarkStep, ReplaceStep, type Step } from '@tiptap/pm/transform';
import { UserTextReplace } from './document/preserving-replace';

/** Adds or removes a mark without changing document structure. */
export const isMarkStep = (step: Step) => step instanceof AddMarkStep || step instanceof RemoveMarkStep;

/** Ordinary typing: a replacement inside one textblock that inserts only inline content. `doc` is the document before the step. */
export function isInlineReplace(step: Step, doc: Node) {
  if (!(step instanceof ReplaceStep) && !(step instanceof UserTextReplace)) return false;
  // The shared parent must be the textblock itself: deleting whole rows or list
  // items also keeps both ends in one parent (the table or list), with an
  // empty slice, but it removes blocks.
  const $from = doc.resolve(step.from);
  if (!$from.parent.isTextblock || !$from.sameParent(doc.resolve(step.to))) return false;
  let inline = true;
  step.slice.content.forEach(node => { if (!node.isInline) inline = false; });
  return inline;
}

/** Ordinary typing or a mark change: it cannot add, remove, move or restructure blocks.
 *  Plugins with a wider notion of "harmless" compose their own predicate from this one. */
export const isTypingStep = (step: Step, docBefore: Node) => isMarkStep(step) || isInlineReplace(step, docBefore);

/** Every step of every transaction satisfies `predicate`, given the document before that step. */
export function everyStep(transactions: readonly Transaction[], predicate: (step: Step, docBefore: Node) => boolean): boolean {
  return transactions.every(transaction => transaction.steps.every((step, index) => predicate(step, transaction.docs[index])));
}
