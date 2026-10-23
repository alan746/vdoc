import { rebaseInverse, type ProtectedRange as Range } from './rebase-inverse';
import { PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Mapping, ReplaceStep, type Step, type StepMap } from '@tiptap/pm/transform';

interface Entry {
  sequence: number;
  turnId?: string;
  step: Step;
  inverse: Step;
  map: StepMap;
  mirrorOf?: number;
}
interface Turn { first: number; active: boolean; undoOf?: string }
interface UndoMetadata { target: string; mirrors: (number | undefined)[] }
export type UndoPlan = { ok: true; transaction: Transaction } | { ok: false; error: string };


/** A bounded command log. It depends on immutable PM state, never on an Editor or UI. */
export class SelectiveUndoHistory {
  private entries: Entry[] = [];
  private turns = new Map<string, Turn>();
  private sequence = 0;
  private metadata = new PluginKey<UndoMetadata>('vdocSelectiveUndo');

  constructor(private readonly maxSteps = 1000) {
    if (!Number.isInteger(maxSteps) || maxSteps < 1) throw new Error('Undo history needs a positive step limit.');
  }

  /** Observe every origin, including normal typing and appended ID normalization. */
  record(transaction: Transaction, appended: readonly Transaction[] = []) {
    const origin = transaction.getMeta('vdoc') as { source?: string; turnId?: string } | undefined;
    const turnId = origin?.source === 'agent' ? origin.turnId : undefined;
    const undo = transaction.getMeta(this.metadata) as UndoMetadata | undefined;
    for (const tr of [transaction, ...appended]) {
      tr.steps.forEach((step, index) => {
        const before = tr.docs[index], after = index + 1 < tr.docs.length ? tr.docs[index + 1] : tr.doc;
        if (before.eq(after)) return;
        const sequence = ++this.sequence;
        this.entries.push({ sequence, turnId, step, inverse: step.invert(before), map: step.getMap(), mirrorOf: tr === transaction ? undo?.mirrors[index] : undefined });
        if (turnId && !this.turns.has(turnId)) this.turns.set(turnId, { first: sequence, active: true });
      });
    }
    if (undo && turnId && this.turns.has(turnId)) {
      this.turns.get(turnId)!.undoOf = undo.target;
      // Undoing an undo restores the availability of the earlier turn too.
      let target: string | undefined = undo.target;
      while (target) {
        const turn = this.turns.get(target);
        if (!turn) break;
        turn.active = !turn.active;
        target = turn.undoOf;
      }
    }
    if (this.entries.length > this.maxSteps) this.entries.splice(0, this.entries.length - this.maxSteps);
    const retained = new Set(this.entries.map(entry => entry.turnId));
    for (const id of this.turns.keys()) if (!retained.has(id)) this.turns.delete(id);
  }

  clear() { this.entries = []; this.turns.clear(); }

  /** Prepare the entire inverse without dispatching; any conflict leaves live state untouched. */
  prepare(state: EditorState, turnId: string, newTurnId: string): UndoPlan {
    const turn = this.turns.get(turnId);
    if (!turn || turn.first < (this.entries[0]?.sequence ?? Infinity)) return { ok: false, error: 'The turn is unknown or older than retained undo history.' };
    if (!turn.active) return { ok: false, error: 'This turn has already been undone.' };
    if (!newTurnId || this.turns.has(newTurnId)) return { ok: false, error: 'Undo needs a new, distinct turn ID.' };
    const transaction = state.tr, mapping = this.mapping(), mirrors: (number | undefined)[] = [];
    try {
      for (let index = this.entries.length - 1; index >= 0; index--) {
        const entry = this.entries[index];
        if (entry.turnId !== turnId) continue;
        const inverse = entry.inverse.map(mapping.slice(index + 1));
        if (!inverse) continue;
        const protectedRanges = this.laterInsertions(index, turnId, mapping);
        const steps = rebaseInverse(entry.step, inverse, protectedRanges, transaction.doc);
        for (let part = 0; part < steps.length; part++) {
          const step = steps[part];
          const applied = step.apply(transaction.doc);
          if (applied.failed || !applied.doc) return { ok: false, error: 'Later edits conflict with this turn; the document is unchanged.' };
          if (applied.doc.eq(transaction.doc)) continue;
          transaction.step(step);
          // Split deletions retain later text in place. Only a restored slice
          // mirrors the original replacement, recovering positions inside it.
          const mirror = steps.length === 1 || (part === steps.length - 1 && step instanceof ReplaceStep && step.slice.size > 0) ? index : undefined;
          mapping.appendMap(step.getMap(), mirror);
          mirrors.push(mirror === undefined ? undefined : entry.sequence);
        }
      }
      transaction.doc.check();
    } catch {
      return { ok: false, error: 'Later edits conflict with this turn; the document is unchanged.' };
    }
    if (!transaction.docChanged || transaction.doc.eq(state.doc)) return { ok: false, error: 'This turn no longer has changes to undo.' };
    return { ok: true, transaction: transaction.setMeta(this.metadata, { target: turnId, mirrors } satisfies UndoMetadata) };
  }

  private mapping(): Mapping {
    const mapping = new Mapping(), positions = new Map<number, number>();
    for (const entry of this.entries) {
      positions.set(entry.sequence, mapping.maps.length);
      mapping.appendMap(entry.map, entry.mirrorOf === undefined ? undefined : positions.get(entry.mirrorOf));
    }
    return mapping;
  }

  private laterInsertions(index: number, turnId: string, mapping: Mapping): Range[] {
    const ranges: Range[] = [];
    for (let later = index + 1; later < this.entries.length; later++) {
      const entry = this.entries[later];
      if (entry.turnId === turnId) continue;
      entry.map.forEach((_oldFrom, _oldTo, start, end) => {
        if (start === end) return;
        const tail = mapping.slice(later + 1), from = tail.mapResult(start, 1), to = tail.mapResult(end, -1);
        if (!from.deletedAcross && !to.deletedAcross && from.pos < to.pos) ranges.push({ from: from.pos, to: to.pos });
      });
    }
    return ranges;
  }
}

