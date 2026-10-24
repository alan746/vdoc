import { TextSelection } from '@tiptap/pm/state';
import type { Node } from '@tiptap/pm/model';
import { findMatches } from './search';
import { defineHandlers } from '../commands/types';
import { textCommands } from '../format/commands';

/** Document ranges of the blocks with these IDs, so a search can be kept inside them. */
function blockRanges(doc: Node, ids: readonly string[]): { from: number; to: number }[] {
  const wanted = new Set(ids), ranges: { from: number; to: number }[] = [];
  doc.descendants((node, pos) => {
    if (!wanted.has(node.attrs.blockId)) return true;
    ranges.push({ from: pos, to: pos + node.nodeSize });
    return false;
  });
  return ranges;
}

export const searchCommands = defineHandlers({
  'text.styleMatches': (op, context) => {
    const { state, reject } = context;
    const scope = op.blockIds ? blockRanges(state.tr.doc, op.blockIds) : null;
    if (scope && !scope.length) return reject('None of the given blocks exist any more. Read the document again.');
    const matches = [...new Set(op.queries)].flatMap(query => findMatches(state.tr.doc, query, op.caseSensitive, op.wholeWord))
      .filter(match => !scope || scope.some(range => match.from >= range.from && match.to <= range.to));
    if (!matches.length) return reject(`None of the given texts occur${scope ? ' in those blocks' : ''}, so nothing was styled. Read the document and use its exact wording.`);
    // Styling only adds or removes marks, so every match keeps its position while the others are styled.
    for (const { from, to } of matches) {
      state.tr.setSelection(TextSelection.create(state.tr.doc, from, to));
      if (!textCommands['text.style']({ type: 'text.style', style: op.style }, context)) return false;
    }
    return true;
  },
  'text.findReplace': (op, { state, reject }) => {
    const matches = findMatches(state.doc, op.query, op.caseSensitive, op.wholeWord);
    if (!matches.length) return reject(`No text matches "${op.query.slice(0, 80)}"${op.wholeWord ? ' as a whole word' : ''}, so nothing was replaced. Read the document and use its exact wording.`);
    for (const { from, to } of matches.reverse()) state.tr.insertText(op.replacement, from, to);
    return true;
  },
});
