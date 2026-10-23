import type { DocumentEngine } from '../../lib/usecases/engine';
import type { RealtimeToolContext } from '../../lib/usecases/ports';

/** Canonical request/context shapes for the realtime protocol scenarios that
 *  vdoc#35 and austinchennn/vRT#22 list under "验收与测试". Centralising them
 *  gives the remaining #35 tasks (context/readBlocks, preview, capability
 *  negotiation) fixtures to extend instead of re-deriving the same shapes the
 *  executor/composition tests already use. */

export const toolContext = (overrides: Partial<RealtimeToolContext> = {}): RealtimeToolContext => ({
  callId: 'call-1', turnId: 'turn-1', epoch: 1, signal: new AbortController().signal, ...overrides,
});

/** Replaces the first block's text, scoped to the engine's current session and revision. */
export function replaceFirstBlockRequest(engine: DocumentEngine, text: string) {
  const snapshot = engine.snapshot();
  return {
    expectedSessionId: snapshot.sessionId, expectedRevision: snapshot.revision,
    target: { kind: 'block' as const, id: snapshot.blocks[0].id },
    operations: [{ type: 'text.replace' as const, text }],
  };
}

/** vdoc#35 "验收与测试": "手动编辑改变版本时旧请求返回冲突" — pins the request to a
 *  revision the engine has already moved past. */
export function staleRevisionRequest(engine: DocumentEngine, text: string) {
  return { ...replaceFirstBlockRequest(engine, text), expectedRevision: engine.revision - 1 };
}

/** vdoc#35 "验收与测试": "一轮多个事务撤销后保留无关手动编辑" — undoes a turn by ID
 *  against the engine's current session and revision. */
export function undoTurnRequest(engine: DocumentEngine, targetTurnId: string) {
  return { targetTurnId, expectedSessionId: engine.sessionId, expectedRevision: engine.revision };
}
