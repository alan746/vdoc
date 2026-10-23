import { Slice, type Node, type Schema } from '@tiptap/pm/model';
import { Mapping, ReplaceStep, Step, StepMap, StepResult, type Mappable } from '@tiptap/pm/transform';

interface Change { from: number; to: number; slice: Slice }

/** One reversible command with disjoint ranges, so later insertions keep their identity. */
class PreservingReplace extends Step {
  constructor(readonly changes: readonly Change[]) { super(); }

  apply(doc: Node): StepResult {
    let result = StepResult.ok(doc);
    for (let i = this.changes.length - 1; i >= 0; i--) {
      const change = this.changes[i];
      result = StepResult.fromReplace(result.doc!, change.from, change.to, change.slice);
      if (result.failed) return result;
    }
    return result;
  }

  getMap(): StepMap {
    return new StepMap(this.changes.flatMap(change => [change.from, change.to - change.from, change.slice.size]));
  }

  invert(doc: Node): Step {
    let offset = 0;
    return new PreservingReplace(this.changes.map(change => {
      const from = change.from + offset;
      offset += change.slice.size - (change.to - change.from);
      return { from, to: from + change.slice.size, slice: doc.slice(change.from, change.to) };
    }));
  }

  map(mapping: Mappable): Step | null {
    const insertions = unpairedInsertions(mapping), changes: Change[] = [];
    for (const change of this.changes) {
      const mapped = new ReplaceStep(change.from, change.to, change.slice).map(mapping);
      if (!mapped) continue;
      if (mapped.from === mapped.to) {
        if (mapped.slice.size) changes.push({ from: mapped.from, to: mapped.to, slice: mapped.slice });
        continue;
      }
      const protectedRanges = insertions.filter(range => range.to > mapped.from && range.from < mapped.to);
      let from = mapped.from, first = true;
      for (const range of protectedRanges) {
        if (range.from > from) {
          changes.push({ from, to: Math.min(range.from, mapped.to), slice: first ? mapped.slice : Slice.empty });
          first = false;
        } else if (first && mapped.slice.size) {
          changes.push({ from, to: from, slice: mapped.slice }); first = false;
        }
        from = Math.max(from, range.to);
      }
      if (from < mapped.to) changes.push({ from, to: mapped.to, slice: first ? mapped.slice : Slice.empty });
    }
    return changes.length ? new PreservingReplace(changes.sort((a, b) => a.from - b.from)) : null;
  }

  toJSON() { return { stepType: 'vdocPreservingReplace', changes: this.changes.map(change => ({ from: change.from, to: change.to, slice: change.slice.toJSON() })) }; }
  static fromJSON(schema: Schema, json: { changes?: { from: number; to: number; slice: unknown }[] }): Step {
    if (!Array.isArray(json.changes) || json.changes.some(change => !Number.isInteger(change.from) || !Number.isInteger(change.to) || change.from < 0 || change.to < change.from)) throw new RangeError('Invalid preserving replacement.');
    return new PreservingReplace(json.changes.map(change => ({ from: change.from, to: change.to, slice: Slice.fromJSON(schema, change.slice) })));
  }
}
// HMR and isolated module reloads can share ProseMirror's JSON registry.
const registryKey = Symbol.for('vdoc.preservingReplace.registry');
const runtime = globalThis as typeof globalThis & { [registryKey]?: WeakSet<typeof Step> };
const registered = runtime[registryKey] ??= new WeakSet<typeof Step>();
if (!registered.has(Step)) { Step.jsonID('vdocPreservingReplace', PreservingReplace); registered.add(Step); }

/** Preserve only unpaired insertions: mirrored undo/redo maps cancel each other. */
function unpairedInsertions(mapping: Mappable): { from: number; to: number }[] {
  const maps = mapping instanceof Mapping ? mapping : mapping instanceof StepMap ? new Mapping([mapping]) : undefined;
  if (!maps) return [];
  const ranges: { from: number; to: number }[] = [];
  for (let i = maps.from; i < maps.to; i++) {
    const mirror = maps.getMirror(i);
    if (mirror !== undefined && mirror >= maps.from && mirror < maps.to) continue;
    maps.maps[i].forEach((_a, _b, start, end) => {
      if (start === end) return;
      const tail = maps.slice(i + 1), from = tail.mapResult(start, 1), to = tail.mapResult(end, -1);
      if (!from.deletedAcross && !to.deletedAcross && from.pos < to.pos) ranges.push({ from: from.pos, to: to.pos });
    });
  }
  return ranges.sort((a, b) => a.from - b.from);
}

/** Forward execution is identical to ReplaceStep; its inverse preserves later input. */
export class UserTextReplace extends Step {
  constructor(private readonly forward: ReplaceStep) { super(); }
  get from() { return this.forward.from; }
  get to() { return this.forward.to; }
  get slice() { return this.forward.slice; }
  apply(doc: Node): StepResult { return this.forward.apply(doc); }
  getMap(): StepMap { return this.forward.getMap(); }
  map(mapping: Mappable): Step | null {
    const mapped = this.forward.map(mapping);
    return mapped ? new UserTextReplace(mapped) : null;
  }
  toJSON() { return this.forward.toJSON(); }
  invert(doc: Node): Step {
    return new PreservingReplace([{ from: this.from, to: this.from + this.slice.size, slice: doc.slice(this.from, this.to) }]);
  }
}
