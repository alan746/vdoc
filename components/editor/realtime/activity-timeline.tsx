'use client';
import { toast } from 'sonner';
import type { DocumentEngine } from '@/lib/usecases/engine';
import { useAgentActivity, type ActivitySubscribe } from './use-agent-activity';

/** vdoc#33: turn-grouped assistant edit history with "Undo turn", shown
 *  while a realtime connection is active. */
const describe = (labels: string[]) => {
  const first = labels[0].startsWith('Undo turn ') ? 'Undo turn' : labels[0];
  return labels.length > 1 ? `${first} +${labels.length - 1}` : first;
};

export function ActivityTimeline({ engine, active, subscribeActivity }: { engine: DocumentEngine; active: boolean; subscribeActivity?: ActivitySubscribe }) {
  const { turns, undoTurn } = useAgentActivity(engine, active, subscribeActivity);
  if (!active || !turns.length) return null;
  return <ol className="realtime-activity" aria-label="Assistant edit history">
    {turns.map(turn => <li key={turn.turnId}>
      <span>{new Date(turn.time).toLocaleTimeString()} · {describe(turn.labels)} · {turn.count} change{turn.count === 1 ? '' : 's'}</span>
      <button type="button" className="quiet-button" onClick={() => {
        const result = undoTurn(turn.turnId);
        if (!result.ok) toast.error(result.error ?? 'This turn could not be undone.');
      }}>Undo turn</button>
    </li>)}
  </ol>;
}
