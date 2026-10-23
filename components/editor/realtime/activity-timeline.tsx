'use client';
import { toast } from 'sonner';
import type { DocumentEngine } from '@/lib/usecases/engine';
import { useAgentActivity } from './use-agent-activity';

/** vdoc#33: turn-grouped assistant edit history with "Undo turn", shown
 *  while a realtime connection is active. */
export function ActivityTimeline({ engine, active }: { engine: DocumentEngine; active: boolean }) {
  const { turns, undoTurn } = useAgentActivity(engine, active);
  if (!active || !turns.length) return null;
  return <ol className="realtime-activity" aria-label="Assistant edit history">
    {turns.map(turn => <li key={turn.turnId}>
      <span>{new Date(turn.time).toLocaleTimeString()} · {turn.count} change{turn.count === 1 ? '' : 's'}</span>
      <button type="button" className="quiet-button" onClick={() => {
        const result = undoTurn(turn.turnId);
        if (!result.ok) toast.error(result.error ?? 'This turn could not be undone.');
      }}>Undo turn</button>
    </li>)}
  </ol>;
}
