'use client';
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import type { DocumentEngine } from '@/lib/usecases/engine';
import type { OperationRecord } from '@/lib/domain/entities/operation';
import { attachAgentActivity, type AgentActivity } from '@/lib/editor/realtime/agent-activity';

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

/** vdoc#33: attaches the view-only activity decorations to the editor for as
 *  long as the realtime controls are mounted (i.e. the adapter is enabled),
 *  drives them from committed agent edits while `active`, and derives the
 *  turn-grouped history for the timeline. */
export function useAgentActivity(engine: DocumentEngine, active: boolean) {
  const subscribe = useCallback((notify: () => void) => engine.subscribe(notify), [engine]);
  const getRecords = useCallback(() => engine.records, [engine]);
  const records = useSyncExternalStore(subscribe, getRecords, getRecords);
  const activity = useRef<AgentActivity | null>(null);
  // Registered once per editor session rather than per connection: plugin
  // registration reconfigures the editor state, which must not happen while
  // the user may be typing (e.g. when a connection drops mid-composition).
  useEffect(() => {
    const attached = attachAgentActivity(engine.editor);
    activity.current = attached;
    return () => { attached.dispose(); if (activity.current === attached) activity.current = null; };
  }, [engine]);
  useEffect(() => {
    const current = activity.current;
    if (!current) return;
    if (!active) { current.clear(); return; }
    return engine.onApplied(event => {
      if (event.source !== 'agent' || !event.changedBlockIds.length) return;
      current.highlight(event.changedBlockIds);
      current.setPresence(event.changedBlockIds[event.changedBlockIds.length - 1]);
    });
  }, [engine, active]);
  const undoTurn = useCallback((turnId: string) => engine.undoTurn(turnId, { actor: 'user-interface', turnId: crypto.randomUUID() }), [engine]);
  return { turns: groupTurns(records), undoTurn };
}
