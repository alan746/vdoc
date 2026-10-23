import { findMatches } from './search';
import { defineHandlers } from '../commands/types';

export const searchCommands = defineHandlers({
  'text.findReplace': (op, { state }) => {
    const matches = findMatches(state.doc, op.query, op.caseSensitive, op.wholeWord);
    if (!matches.length) return false;
    for (const { from, to } of matches.reverse()) state.tr.insertText(op.replacement, from, to);
    return true;
  },
});
