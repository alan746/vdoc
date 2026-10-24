import type { MicrophoneStatus, RealtimeStatus, RealtimeTurnState } from '@/lib/usecases/ports';

/** What the assistant is doing, shown as the status light in the page corner. */
export type AgentStatus = 'idle' | 'connecting' | 'listening' | 'thinking' | 'writing' | 'speaking' | 'error';

export const agentStatusLabels: Record<AgentStatus, string> = {
  idle: 'Idle', connecting: 'Connecting', listening: 'Listening', thinking: 'Thinking', writing: 'Writing', speaking: 'Speaking', error: 'Error',
};

/** `writing` is true while a document tool's content is streaming into the page. */
export function agentStatus(input: { checking: boolean; status: RealtimeStatus; microphone: MicrophoneStatus; turn: RealtimeTurnState; writing: boolean }): AgentStatus {
  const { checking, status, microphone, turn, writing } = input;
  if (checking || status === 'disconnected') return 'idle';
  if (status === 'error' || microphone === 'error') return 'error';
  if (status === 'connecting' || status === 'reconnecting' || microphone === 'requesting' || microphone === 'ready') return 'connecting';
  if (writing) return 'writing';
  if (turn === 'thinking' || turn === 'acting') return 'thinking';
  if (turn === 'speaking') return 'speaking';
  return 'listening';
}
