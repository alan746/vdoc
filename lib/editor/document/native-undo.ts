import { UndoRedo } from '@tiptap/extensions';
import { ReplaceStep } from '@tiptap/pm/transform';
import { isHistoryTransaction } from '@tiptap/pm/history';
import { UserTextReplace } from './preserving-replace';

/** Adapt history commands at the documented dispatch boundary, without changing history internals. */
export const ConcurrentUndoRedo = UndoRedo.extend({
  dispatchTransaction({ transaction, next }) {
    if (transaction.getMeta('addToHistory') !== false && !isHistoryTransaction(transaction)) {
      transaction.steps.forEach((step, index) => {
        if (!(step instanceof ReplaceStep)) return;
        const doc = transaction.docs[index], $from = doc.resolve(step.from), $to = doc.resolve(step.to);
        let inline = !step.slice.openStart && !step.slice.openEnd;
        step.slice.content.forEach(node => { if (!node.isInline) inline = false; });
        if (inline && $from.sameParent($to) && $from.parent.isTextblock) {
          // Same apply() and getMap(): the existing docs/mapping stay valid.
          transaction.steps[index] = new UserTextReplace(step);
        }
      });
    }
    next(transaction);
  },
});
