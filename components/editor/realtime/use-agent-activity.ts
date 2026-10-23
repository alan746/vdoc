'use client';
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import type { DocumentEngine } from '@/lib/usecases/engine';
import type { OperationRecord } from '@/lib/domain/entities/operation';
import type { RealtimeActivity } from '@/lib/usecases/ports';
import { attachAgentActivity, type AgentActivity } from '@/lib/editor/realtime/agent-activity';

export type AgentTurn = { turnId: string; actor: string; time: number; count: number; labels: string[] };
export type ActivitySubscribe = (listener: (activity: RealtimeActivity) => void) => () => void;

/** The block an apply call targets, read from untrusted model arguments only
 *  as a display hint (the commit itself re-validates everything). */
export function targetBlockId(args: unknown): string | undefined {
  const target = args && typeof args === 'object' && 'target' in args ? (args as { target: unknown }).target : undefined;
  if (!target || typeof target !== 'object') return undefined;
  const { kind, id, blockId, tableId } = target as Record<string, unknown>;
  const candidate = kind === 'block' ? id : kind === 'text' ? blockId : kind === 'cell' || kind === 'cells' ? tableId : undefined;
  return typeof candidate === 'string' ? candidate : undefined;
}

function groupTurns(records: readonly OperationRecord[]): AgentTurn[] {
  const turns = new Map<string, AgentTurn>();
  // engine.records is newest-first; keep that order for the turns too.
  for (const record of records) {
    if (record.source !== 'agent' || !record.turnId) continue;
    const existing = turns.get(record.turnId);
    if (existing) { existing.count += record.count; existing.time = Math.max(existing.time, record.time); existing.labels.unshift(record.label); }
    else turns.set(record.turnId, { turnId: record.turnId, actor: record.actor ?? 'agent', time: record.time, count: record.count, labels: [record.label] });
  }
  return [...turns.values()];
}

/** vdoc#33: attaches the view-only activity decorations to the editor for as
 *  long as the realtime controls are mounted (i.e. the adapter is enabled),
 *  drives them from committed agent edits while `active`, and derives the
 *  turn-grouped history for the timeline. */
export function useAgentActivity(engine: DocumentEngine, active: boolean, subscribeActivity?: ActivitySubscribe) {
  const subscribe = useCallback((notify: () => void) => engine.subscribe(notify), [engine]);
  const getRecords = useCallback(() => engine.records, [engine]);
  const records = useSyncExternalStore(subscribe, getRecords, getRecords);
  const activity = useRef<AgentActivity | null>(null);
  // Registered once per editor session rather than per connection: plugin
  // registration reconfigures the editor state, which must not happen while
  // the user may be typing (e.g. when a connection drops mid-composition).
  useEffect(() => {
    const attached = attachAgentActivity(engine.editor, { locate: id => engine.locateBlock(id) });
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
  // A call's target is marked as soon as the call arrives, before it runs (it
  // may wait for IME composition); the commit then moves the marker to the
  // blocks that actually changed. A failed or interrupted call clears it.
  useEffect(() => {
    const current = activity.current;
    if (!current || !active || !subscribeActivity) return;
    let pending: string | undefined;
    return subscribeActivity(event => {
      if (event.type === 'call' && event.name === 'apply_document_operations') {
        const id = targetBlockId(event.arguments);
        if (id && engine.hasBlock(id)) { pending = event.callId; current.setPresence(id); }
      } else if (event.type === 'result' && event.callId === pending) {
        pending = undefined;
        if (!event.ok) current.setPresence(null);
      } else if (event.type === 'interrupted' && pending) {
        pending = undefined;
        current.setPresence(null);
      }
    });
  }, [engine, active, subscribeActivity]);
  const undoTurn = useCallback((turnId: string) => engine.undoTurn(turnId, { actor: 'user-interface', turnId: crypto.randomUUID() }), [engine]);
  return { turns: groupTurns(records), undoTurn };
}
