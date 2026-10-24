import { findMatches } from './search';
import { defineHandlers } from '../commands/types';

export const searchCommands = defineHandlers({
  'text.findReplace': (op, { state, reject }) => {
    const matches = findMatches(state.doc, op.query, op.caseSensitive, op.wholeWord);
    if (!matches.length) return reject(`No text matches "${op.query.slice(0, 80)}"${op.wholeWord ? ' as a whole word' : ''}, so nothing was replaced. Read the document and use its exact wording.`);
    for (const { from, to } of matches.reverse()) state.tr.insertText(op.replacement, from, to);
    return true;
  },
});
