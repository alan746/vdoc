'use client';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { DocumentEngine } from '@/lib/usecases/engine';
import type { OperationRecord } from '@/lib/domain/entities/operation';
import { clearAgentActivity, highlightChangedBlocks, setAgentPresence } from '@/lib/editor/realtime/agent-activity';

export type AgentTurn = { turnId: string; actor: string; time: number; count: number };

function groupTurns(records: readonly OperationRecord[]): AgentTurn[] {
  const turns = new Map<string, AgentTurn>();
  // engine.records is newest-first; keep that order for the turns too.
  for (const record of records) {
    if (record.source !== 'agent' || !record.turnId) continue;
    const existing = turns.get(record.turnId);
    if (existing) { existing.count += record.count; existing.time = Math.max(existing.time, record.time); }
    else turns.set(record.turnId, { turnId: record.turnId, actor: record.actor ?? 'agent', time: record.time, count: record.count });
  }
  return [...turns.values()];
}

/** vdoc#33: drives the view-only AgentActivity decorations from committed
 *  agent edits while `active`, and derives the turn-grouped history for the
 *  timeline. Clears decorations on disconnect/unmount so a closed
 *  connection leaves no stray highlight or presence marker. */
export function useAgentActivity(engine: DocumentEngine, active: boolean) {
  const subscribe = useCallback((notify: () => void) => engine.subscribe(notify), [engine]);
  const getRecords = useCallback(() => engine.records, [engine]);
  const records = useSyncExternalStore(subscribe, getRecords, getRecords);
  useEffect(() => {
    if (!active) { clearAgentActivity(engine.editor); return; }
    return engine.onApplied(event => {
      if (event.source !== 'agent' || !event.changedBlockIds.length) return;
      highlightChangedBlocks(engine.editor, event.changedBlockIds);
      setAgentPresence(engine.editor, event.changedBlockIds[event.changedBlockIds.length - 1]);
    });
  }, [engine, active]);
  // Guarantee a clear on unmount even if it happens while still active (the
  // effect above's own cleanup only unsubscribes, it does not clear).
  useEffect(() => () => clearAgentActivity(engine.editor), [engine]);
  const undoTurn = useCallback((turnId: string) => engine.undoTurn(turnId, { actor: 'user-interface', turnId: crypto.randomUUID() }), [engine]);
  return { turns: groupTurns(records), undoTurn };
}
