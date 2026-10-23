import { Mark, Slice, type Node } from '@tiptap/pm/model';
import { AddMarkStep, AttrStep, DocAttrStep, ReplaceAroundStep, ReplaceStep, Transform, type Step } from '@tiptap/pm/transform';

export interface ProtectedRange { from: number; to: number }
type Range = ProtectedRange;
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const isMarkup = (step: ReplaceAroundStep) => step.gapFrom === step.from + 1 && step.gapTo === step.to - 1 && step.insert === 1 && step.slice.size === 2;

/** Conflict policy: preserve later text and later writes to individual attributes. */
export function rebaseInverse(forward: Step, inverse: Step, protectedRanges: readonly ProtectedRange[], doc: Node): Step[] {
  if (inverse instanceof AddMarkStep) {
    const steps: Step[] = [];
    doc.nodesBetween(inverse.from, inverse.to, (node, pos) => {
      if (!node.isInline) return;
      const current = inverse.mark.type.isInSet(node.marks);
      if (!current || current.eq(inverse.mark)) steps.push(new AddMarkStep(Math.max(pos, inverse.from), Math.min(pos + node.nodeSize, inverse.to), inverse.mark));
      return false;
    });
    return steps;
  }
  if (forward instanceof DocAttrStep && inverse instanceof DocAttrStep && !equal(doc.attrs[forward.attr], forward.value)) return [];
  if (forward instanceof AttrStep && inverse instanceof AttrStep && !equal(doc.nodeAt(inverse.pos)?.attrs[forward.attr], forward.value)) return [];
  if (forward instanceof ReplaceAroundStep && inverse instanceof ReplaceAroundStep && isMarkup(forward) && isMarkup(inverse)) {
    const was = inverse.slice.content.firstChild!, written = forward.slice.content.firstChild!, current = doc.nodeAt(inverse.from);
    if (!current) return [];
    const attrs = { ...current.attrs };
    for (const key of Object.keys(was.attrs)) {
      if (!equal(was.attrs[key], written.attrs[key]) && equal(current.attrs[key], written.attrs[key])) attrs[key] = was.attrs[key];
    }
    const type = current.type === written.type ? was.type : current.type;
    const marks = Mark.sameSet(current.marks, written.marks) ? was.marks : current.marks;
    return new Transform(doc).setNodeMarkup(inverse.from, type, attrs, marks).steps;
  }
  return preserveLaterInput(inverse, protectedRanges, doc);
}

/** Rebase text removal around later insertions, preserving their position maps and native undo. */
function preserveLaterInput(inverse: Step, protectedRanges: readonly Range[], doc: Node): Step[] {
  if (!(inverse instanceof ReplaceStep) || inverse.from === inverse.to) return [inverse];
  const protectedInside = protectedRanges
    .map(range => ({ from: Math.max(inverse.from, range.from), to: Math.min(inverse.to, range.to) }))
    .filter(range => range.from < range.to).sort((a, b) => a.from - b.from);
  if (!protectedInside.length) return [inverse];
  const $from = doc.resolve(inverse.from), $to = doc.resolve(inverse.to);
  if (!$from.sameParent($to) || !$from.parent.isTextblock || inverse.slice.openStart || inverse.slice.openEnd ||
      Array.from({ length: inverse.slice.content.childCount }, (_, i) => inverse.slice.content.child(i)).some(node => !node.isInline)) {
    throw new Error('Cannot remove a structure containing later edits.');
  }
  const removable: Range[] = [];
  let from = inverse.from;
  for (const range of protectedInside) {
    if (range.from > from) removable.push({ from, to: range.from });
    from = Math.max(from, range.to);
  }
  if (from < inverse.to) removable.push({ from, to: inverse.to });
  // If all inserted content was replaced by someone else, do not resurrect the
  // old content on top of their replacement.
  if (!removable.length) return [];
  const steps: Step[] = removable.reverse().map(range => new ReplaceStep(range.from, range.to, Slice.empty));
  if (inverse.slice.size) steps.push(new ReplaceStep(inverse.from, inverse.from, inverse.slice));
  return steps;
}
