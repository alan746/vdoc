import type { DocumentEngine } from './engine';
import { documentNavigation } from './document-navigation';
import { agentRequestSchema, type OperationResult } from '../domain/entities/operation';
import { z } from 'zod';
import type { RealtimeToolContext } from './ports';

export const realtimeApplySchema = agentRequestSchema.omit({ id: true });
export const realtimeUndoSchema = z.object({
  targetTurnId: z.string().min(1).max(128),
  expectedSessionId: z.string().min(1).max(128),
  expectedRevision: z.number().int().min(0),
}).strict();

/** Document checks inside SDK run(). The SDK owns ordering, epochs and results. */
export function createRealtimeExecutor(engine: DocumentEngine, options: {
  docId: string; actor: string; currentDocument: () => { docId: string; sessionId: string } | null;
  signal: AbortSignal; compositionTimeoutMs?: number;
}) {
  const sessionId = engine.sessionId;
  const completed = new Map<string, { signature: string; result: OperationResult }>();
  const failure = (id: string, code: OperationResult['code'] | 'INTERRUPTED' | 'TIMEOUT', error: string) => ({ ok: false as const, id, revision: engine.revision, code, error });
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
    let result: OperationResult;
    if (name === 'apply') result = engine.executeAgent({ ...parsed.data, id: context.callId }, origin);
    else {
      const undo = realtimeUndoSchema.parse(parsed.data);
      if (undo.expectedSessionId !== sessionId || undo.expectedRevision !== engine.revision)
        return failure(context.callId, 'STALE', 'The document changed. Read it again before undoing.');
      result = engine.undoTurn(undo.targetTurnId, origin);
    }
    // Retain every successful call for this document connection. Bound memory
    // by closing the connection, not by forgetting IDs and replaying old writes.
    if (result.ok) completed.set(context.callId, { signature, result });
    return result;
  }
  return {
    read(context: RealtimeToolContext) { return check(context) ?? { ...engine.snapshot(), docId: options.docId, agentEdits: engine.records.filter(record => record.source === 'agent') }; },
    apply: (input: unknown, context: RealtimeToolContext) => run('apply', input, context),
    undo: (input: unknown, context: RealtimeToolContext) => run('undo', input, context),
  };
}
