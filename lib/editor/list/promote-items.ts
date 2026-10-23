import type { Node } from '@tiptap/pm/model';

/** Blocks of a list item promoted out of its list. The first promoted numbered
 * list must not attach to a newly adjacent list, so its continuation is cleared. */
export function promotedItemContent(item: Node): Node[] {
  const output: Node[] = [];
  let previousNumbered = false;
  for (const child of item.content.content) {
    output.push(child.type.name === 'orderedList' && child.attrs.continuePrevious && !previousNumbered
      ? child.type.create({ ...child.attrs, continuePrevious: false }, child.content, child.marks)
      : child);
    if (child.type.name === 'orderedList') previousNumbered = true;
  }
  return output;
}
