import type { SelectionAnchor } from './engine';
import { agentRequestSchema, operationSchema, validateBlockPlacements, type AgentOrigin, type AppliedChange, type OperationRecord, type OperationResult } from '../domain/entities/operation';
import type { BlockRead, DocumentSnapshot, OutlineEntry, SelectionBlockContext } from '../editor/document-snapshot';
import { z } from 'zod/v3';
import type { RealtimeToolContext } from './ports';
import { requestSignature } from '../shared/request-signature';

// Format paste replaces all character formatting. Keep it available to the
// editor/API, but exclude it from both the realtime schema and runtime parser.
const realtimeOperationSchema = z.discriminatedUnion('type', [
  operationSchema.options[0],
  ...operationSchema.options.slice(1).filter(option => option.shape.type.value !== 'format.apply'),
]);
export const realtimeApplySchema = agentRequestSchema.omit({ id: true }).extend({
  operations: z.array(realtimeOperationSchema).min(1).max(100),
}).superRefine(validateBlockPlacements);
export const realtimeUndoSchema = z.object({
  targetTurnId: z.string().min(1).max(128),
  expectedSessionId: z.string().min(1).max(128),
  expectedRevision: z.number().int().min(0),
}).strict();
export const realtimeReadBlocksSchema = z.object({ ids: z.array(z.string().min(1).max(128)).min(1).max(200) }).strict();

/** Preserve the field path so the caller can repair a rejected request. */
function invalidArguments(error: z.ZodError) {
  const issue = error.issues[0];
  if (!issue) return 'Invalid arguments.';
  const path = issue.path.reduce<string>((text, part) => typeof part === 'number'
    ? `${text}[${part}]` : `${text}${text ? '.' : ''}${part}`, '');
  return `${path || 'arguments'}: ${issue.message}`;
}
/** Frozen turn selections kept per connection; only the latest turn is normally in use. */
const FROZEN_TURN_LIMIT = 64;
/** A past agent turn's affected blocks, re-checked against the live document
 *  so a deleted target or a later document switch cannot be referenced as
 *  "the thing I just edited". */
export type RecentVoiceEdit = { id: string; turnId: string; actor: string; revision: number; affectedBlockIds: readonly string[] };

/** What the executor needs from the document engine, and nothing else (vdoc#43).
 *  DocumentEngine satisfies it structurally; there is deliberately no editor
 *  member, so the realtime layer does not depend on Tiptap/ProseMirror types. */
export interface RealtimeEngine {
  readonly sessionId: string;
  readonly revision: number;
  readonly records: readonly OperationRecord[];
  canEdit(): boolean;
  isComposing(): boolean;
  executeAgent(input: unknown, origin: AgentOrigin): OperationResult;
  undoTurn(turnId: string, origin: AgentOrigin): OperationResult;
  snapshot(): DocumentSnapshot;
  outline(): OutlineEntry[];
  readBlocks(ids: readonly string[]): BlockRead;
  selectionContext(selection: { from: number; to: number }): SelectionBlockContext;
  hasBlock(id: string): boolean;
  anchorSelection(): SelectionAnchor;
  onApplied(listener: (event: AppliedChange) => void): () => void;
}

/** Document checks inside SDK run(). The SDK owns ordering, epochs and results:
 *  it never starts a call from a closed epoch and aborts a running call's
 *  signal, which check() and the composition wait observe (vdoc#47). */
export function createRealtimeExecutor(engine: RealtimeEngine, options: {
  docId: string; actor: string; currentDocument: () => { docId: string; sessionId: string } | null;
  signal: AbortSignal; compositionTimeoutMs?: number;
}) {
  const sessionId = engine.sessionId;
  const completed = new Map<string, { signature: string; result: OperationResult }>();
  const failure = (id: string, code: OperationResult['code'] | 'INTERRUPTED' | 'TIMEOUT', error: string) => ({ ok: false as const, id, revision: engine.revision, code, error });
  // Recent agent edits for "the table I just added"; bounded, and re-checked
  // against the live document on every read (see recentVoiceEdits below).
  const recentAgentEdits: AppliedChange[] = [];
  const unsubscribe = engine.onApplied(event => {
    if (event.source !== 'agent') return;
    recentAgentEdits.unshift(event);
    recentAgentEdits.length = Math.min(recentAgentEdits.length, 20);
  });
  // A voice turn plans against the selection it saw when it first read the
  // document: later cursor movement must not re-interpret "this paragraph",
  // but edits (including this turn's own) must still move it with the content,
  // so it is an anchor the engine maps, not raw positions. Turns arrive one
  // after another, so evicting the oldest-started turn (insertion order) never
  // drops the active one; each eviction releases its anchor.
  const frozenSelections = new Map<string, SelectionAnchor>();
  function frozenSelection(context: RealtimeToolContext) {
    let anchor = frozenSelections.get(context.turnId);
    if (!anchor) {
      anchor = engine.anchorSelection();
      frozenSelections.set(context.turnId, anchor);
      if (frozenSelections.size > FROZEN_TURN_LIMIT) {
        const [oldestTurn, oldest] = frozenSelections.entries().next().value!;
        oldest.release(); frozenSelections.delete(oldestTurn);
      }
    }
    return anchor.resolve();
  }
  const dispose = () => {
    unsubscribe();
    for (const anchor of frozenSelections.values()) anchor.release();
    frozenSelections.clear();
  };
  options.signal.addEventListener('abort', dispose, { once: true });
  if (options.signal.aborted) dispose();
  function recentVoiceEdits(): RecentVoiceEdit[] {
    return recentAgentEdits.map(event => ({ id: event.id, turnId: event.turnId!, actor: event.actor!, revision: event.revision, affectedBlockIds: event.changedBlockIds.filter(id => engine.hasBlock(id)) }));
  }
  function check(context: RealtimeToolContext) {
    if (context.signal.aborted || options.signal.aborted) return failure(context.callId, 'INTERRUPTED', 'The call was cancelled.');
    const current = options.currentDocument();
    if (!current || current.docId !== options.docId || current.sessionId !== sessionId || !engine.canEdit())
      return failure(context.callId, 'UNAVAILABLE', 'The document session is no longer editable.');
    if (!context.callId || context.callId.length > 128 || !context.turnId || context.turnId.length > 128)
      return failure(context.callId, 'INVALID', 'The server must provide a call ID and turn ID.');
  }
  function waitForComposition(context: RealtimeToolContext): Promise<void> {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + (options.compositionTimeoutMs ?? 5000);
      let timer: ReturnType<typeof setTimeout>;
      const cleanup = () => { clearTimeout(timer); context.signal.removeEventListener('abort', cancel); options.signal.removeEventListener('abort', cancel); };
      const cancel = () => { cleanup(); resolve(); };
      const poll = () => {
        if (check(context) || !engine.isComposing()) { cleanup(); resolve(); }
        else if (Date.now() >= deadline) { cleanup(); reject(new Error('Composition timed out. Finish typing and retry.')); }
        else timer = setTimeout(poll, 20);
      };
      context.signal.addEventListener('abort', cancel, { once: true });
      options.signal.addEventListener('abort', cancel, { once: true });
      poll();
    });
  }
  type WriteResult = OperationResult | ReturnType<typeof failure>;
  /** The one path every write tool takes: binding check, schema, dedup by call
   *  ID, composition wait, a final re-check, then exactly one synchronous
   *  engine call. Only `write` differs between tools. */
  async function trustedWrite<T>(tool: 'apply' | 'undo', schema: z.ZodType<T, z.ZodTypeDef, unknown>, input: unknown, context: RealtimeToolContext,
    write: (args: T, origin: AgentOrigin) => WriteResult) {
    const invalid = check(context); if (invalid) return invalid;
    const parsed = schema.safeParse(input);
    if (!parsed.success) return failure(context.callId, 'INVALID', invalidArguments(parsed.error));
    const signature = requestSignature({ tool, input: parsed.data, turnId: context.turnId });
    const previous = completed.get(context.callId);
    if (previous) return previous.signature === signature ? previous.result : failure(context.callId, 'DUPLICATE', 'Call ID reused with different arguments.');
    if (engine.isComposing()) {
      try { await waitForComposition(context); }
      catch { return check(context) ?? failure(context.callId, 'TIMEOUT', 'Composition timed out. Finish typing and retry.'); }
    }
    if (completed.size >= 10000) return failure(context.callId, 'UNAVAILABLE', 'Reconnect to start a new document connection.');
    const invalidAfterWait = check(context); if (invalidAfterWait) return invalidAfterWait;
    // No await between this boundary and the synchronous writer. The engine
    // validates session/revision/block versions again against the live document.
    const result = write(parsed.data, { actor: options.actor, turnId: context.turnId });
    if (!result.ok) return result;
    // The onApplied listener above already recorded this call's own event (if
    // the document actually changed) before the engine returned; match it by
    // result.id rather than assuming it is first, since a no-op success emits
    // no event at all. Retain every success for this connection: memory is
    // bounded by closing the connection, not by forgetting IDs and replaying.
    const enriched = { ...result, affectedBlockIds: recentAgentEdits.find(event => event.id === result.id)?.changedBlockIds ?? [] };
    completed.set(context.callId, { signature, result: enriched });
    return enriched;
  }
  const apply = (input: unknown, context: RealtimeToolContext) => trustedWrite('apply', realtimeApplySchema, input, context,
    (args, origin) => engine.executeAgent({ ...args, id: context.callId }, origin));
  const undo = (input: unknown, context: RealtimeToolContext) => trustedWrite('undo', realtimeUndoSchema, input, context,
    (args, origin) => args.expectedSessionId !== sessionId || args.expectedRevision !== engine.revision
      ? failure(context.callId, 'STALE', 'The document changed. Read it again before undoing.')
      : engine.undoTurn(args.targetTurnId, origin));
  return {
    read(context: RealtimeToolContext) {
      return check(context) ?? { ...engine.snapshot(), docId: options.docId, agentEdits: engine.records.filter(record => record.source === 'agent') };
    },
    /** Lightweight per-turn planning context (vdoc#35 task 1), separate from
     *  the full document read: outline, a selection frozen for this turn,
     *  and recent agent edits re-checked against the live document. Needs an
     *  agent turn (frozenSelection keys off context.turnId), so this is
     *  realtime-only — the WebMCP bridge has no turn concept and does not
     *  register it. */
    getContext(context: RealtimeToolContext) {
      const invalid = check(context); if (invalid) return invalid;
      const selection = frozenSelection(context);
      return { docId: options.docId, sessionId, revision: engine.revision, selection, blockContext: engine.selectionContext(selection), outline: engine.outline(), recentEdits: recentVoiceEdits() };
    },
    readBlocks(input: unknown, context: RealtimeToolContext) {
      const invalid = check(context); if (invalid) return invalid;
      const parsed = realtimeReadBlocksSchema.safeParse(input);
      if (!parsed.success) return failure(context.callId, 'INVALID', invalidArguments(parsed.error));
      return { docId: options.docId, sessionId, revision: engine.revision, ...engine.readBlocks(parsed.data.ids) };
    },
    apply,
    undo,
  };
}
