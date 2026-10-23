import type { Node } from '@tiptap/pm/model';
import { AddMarkStep, RemoveMarkStep, ReplaceStep, type Step } from '@tiptap/pm/transform';
import { UserTextReplace } from './document/preserving-replace';

/** Adds or removes a mark without changing document structure. */
export const isMarkStep = (step: Step) => step instanceof AddMarkStep || step instanceof RemoveMarkStep;

/** Ordinary typing: a replacement inside one textblock that inserts only inline content. `doc` is the document before the step. */
export function isInlineReplace(step: Step, doc: Node) {
  if (!(step instanceof ReplaceStep) && !(step instanceof UserTextReplace)) return false;
  if (!doc.resolve(step.from).sameParent(doc.resolve(step.to))) return false;
  let inline = true;
  step.slice.content.forEach(node => { if (!node.isInline) inline = false; });
  return inline;
}
