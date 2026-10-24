import type { MicrophoneStatus, RealtimeStatus, RealtimeTurnState } from '@/lib/usecases/ports';

/** What the assistant is doing right now, shown as the two lights at the ends of the voice bar. */
export type VoiceLamp = 'off' | 'connecting' | 'listening' | 'working' | 'speaking' | 'interrupted' | 'error';

/** How long the "interrupted" light stays on before the bar returns to listening. */
export const INTERRUPTED_LAMP_MS = 2500;

export const voiceLampLabels: Record<VoiceLamp, string> = {
  off: 'Voice off',
  connecting: 'Connecting… wait before speaking',
  listening: 'Listening: speak now',
  working: 'Working: you can add details; press Stop to cancel',
  speaking: 'Assistant speaking: speak to interrupt',
  interrupted: 'Stopped: the last task was interrupted',
  error: 'Something went wrong: try again',
};

/** Legend order, in the order a user normally sees them. */
export const voiceLampOrder: readonly VoiceLamp[] = ['listening', 'working', 'speaking', 'interrupted', 'connecting', 'error', 'off'];

export function voiceLamp(input: { checking: boolean; status: RealtimeStatus; microphone: MicrophoneStatus; turn: RealtimeTurnState; failed: boolean; interrupted: boolean }): VoiceLamp {
  const { checking, status, microphone, turn, failed, interrupted } = input;
  if (checking || status === 'disconnected') return 'off';
  if (status === 'error' || microphone === 'error') return 'error';
  if (status === 'connecting' || status === 'reconnecting' || microphone === 'requesting' || microphone === 'ready') return 'connecting';
  // A new task that has already started is more important than the earlier interruption or failure.
  if (turn === 'thinking' || turn === 'acting') return 'working';
  if (turn === 'speaking') return 'speaking';
  if (turn === 'listening') return 'listening';
  if (interrupted) return 'interrupted';
  if (failed) return 'error';
  return 'listening';
}
