import type { DocumentEngine } from './engine';
import { documentNavigation } from './document-navigation';
import { agentRequestSchema, type AppliedChange, type OperationResult } from '../domain/entities/operation';
import { z } from 'zod';
import type { RealtimeToolContext } from './ports';

export const realtimeApplySchema = agentRequestSchema.omit({ id: true });
export const realtimeUndoSchema = z.object({
  targetTurnId: z.string().min(1).max(128),
  expectedSessionId: z.string().min(1).max(128),
  expectedRevision: z.number().int().min(0),
}).strict();
export const realtimeReadBlocksSchema = z.object({ ids: z.array(z.string().min(1).max(128)).min(1).max(200) }).strict();
/** A past agent turn's affected blocks, re-checked against the live document
 *  so a deleted target or a later document switch cannot be referenced as
 *  "the thing I just edited". */
export type RecentVoiceEdit = { id: string; turnId: string; actor: string; revision: number; affectedBlockIds: readonly string[] };

/** Document checks inside SDK run(). The SDK owns ordering, epochs and results. */
export function createRealtimeExecutor(engine: DocumentEngine, options: {
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
  options.signal.addEventListener('abort', unsubscribe, { once: true });
  if (options.signal.aborted) unsubscribe();
  // A voice turn plans against the selection it saw when it first read the
  // document; later cursor movement must not re-interpret "this paragraph".
  const frozenSelections = new Map<string, { from: number; to: number }>();
  function frozenSelection(context: RealtimeToolContext) {
    let selection = frozenSelections.get(context.turnId);
    if (!selection) {
      selection = { from: engine.editor.state.selection.from, to: engine.editor.state.selection.to };
      if (frozenSelections.size >= 10000) frozenSelections.clear();
      frozenSelections.set(context.turnId, selection);
    }
    return selection;
  }
  function recentVoiceEdits(): RecentVoiceEdit[] {
    const live = new Set(engine.snapshot().blocks.map(block => block.id));
    return recentAgentEdits.map(event => ({ id: event.id, turnId: event.turnId!, actor: event.actor!, revision: event.revision, affectedBlockIds: event.changedBlockIds.filter(id => live.has(id)) }));
  }
  function check(context: RealtimeToolContext) {
    if (context.signal.aborted || options.signal.aborted) return failure(context.callId, 'INTERRUPTED', 'The call was cancelled.');
    const current = options.currentDocument();
    if (!current || current.docId !== options.docId || current.sessionId !== sessionId || engine.editor.isDestroyed || !engine.editor.isEditable)
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
        if (check(context) || !documentNavigation(engine.editor).isComposing()) { cleanup(); resolve(); }
        else if (Date.now() >= deadline) { cleanup(); reject(new Error('Composition timed out. Finish typing and retry.')); }
        else timer = setTimeout(poll, 20);
      };
      context.signal.addEventListener('abort', cancel, { once: true });
      options.signal.addEventListener('abort', cancel, { once: true });
      poll();
    });
  }
  async function run(name: 'apply' | 'undo', input: unknown, context: RealtimeToolContext) {
    const invalid = check(context); if (invalid) return invalid;
    const parsed = name === 'apply' ? realtimeApplySchema.safeParse(input) : realtimeUndoSchema.safeParse(input);
    if (!parsed.success) return failure(context.callId, 'INVALID', parsed.error.issues[0]?.message ?? 'Invalid arguments.');
    const signature = JSON.stringify({ name, input: parsed.data, turnId: context.turnId });
    const previous = completed.get(context.callId);
    if (previous) return previous.signature === signature ? previous.result : failure(context.callId, 'DUPLICATE', 'Call ID reused with different arguments.');
    if (documentNavigation(engine.editor).isComposing()) {
      try { await waitForComposition(context); }
      catch { return check(context) ?? failure(context.callId, 'TIMEOUT', 'Composition timed out. Finish typing and retry.'); }
    }
    if (completed.size >= 10000) return failure(context.callId, 'UNAVAILABLE', 'Reconnect to start a new document connection.');
    const invalidAfterWait = check(context); if (invalidAfterWait) return invalidAfterWait;
    // No await between this boundary and the synchronous writer. The engine
    // validates session/revision/block versions again against the live document.
    const origin = { actor: options.actor, turnId: context.turnId };
    let result: OperationResult & { affectedBlockIds?: readonly string[] };
    if (name === 'apply') result = engine.executeAgent({ ...parsed.data, id: context.callId }, origin);
    else {
      const undo = realtimeUndoSchema.parse(parsed.data);
      if (undo.expectedSessionId !== sessionId || undo.expectedRevision !== engine.revision)
        return failure(context.callId, 'STALE', 'The document changed. Read it again before undoing.');
      result = engine.undoTurn(undo.targetTurnId, origin);
    }
    // Retain every successful call for this document connection. Bound memory
    // by closing the connection, not by forgetting IDs and replaying old writes.
    if (result.ok) {
      // The onApplied listener above already recorded this call's own event
      // (if the document actually changed) before executeAgent/undoTurn
      // returned; match it by result.id rather than assuming it is first,
      // since a no-op success emits no event at all.
      result = { ...result, affectedBlockIds: recentAgentEdits.find(event => event.id === result.id)?.changedBlockIds ?? [] };
      completed.set(context.callId, { signature, result });
    }
    return result;
  }
  return {
    read(context: RealtimeToolContext) {
      return check(context) ?? { ...engine.snapshot(), docId: options.docId, selection: frozenSelection(context), outline: engine.outline(),
        agentEdits: engine.records.filter(record => record.source === 'agent'), recentEdits: recentVoiceEdits() };
    },
    readBlocks(input: unknown, context: RealtimeToolContext) {
      const invalid = check(context); if (invalid) return invalid;
      const parsed = realtimeReadBlocksSchema.safeParse(input);
      if (!parsed.success) return failure(context.callId, 'INVALID', parsed.error.issues[0]?.message ?? 'Invalid arguments.');
      return { docId: options.docId, sessionId, revision: engine.revision, ...engine.readBlocks(parsed.data.ids) };
    },
    apply: (input: unknown, context: RealtimeToolContext) => run('apply', input, context),
    undo: (input: unknown, context: RealtimeToolContext) => run('undo', input, context),
  };
}
