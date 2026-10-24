import { expect, it } from 'vitest';
import { voiceLamp } from '../components/editor/realtime/voice-lamp';

const connected = { checking: false, status: 'connected', microphone: 'on', turn: 'idle', failed: false, interrupted: false } as const;

it('shows the voice bar off until a session connects', () => {
  expect(voiceLamp({ ...connected, status: 'disconnected' })).toBe('off');
  expect(voiceLamp({ ...connected, checking: true })).toBe('off');
  expect(voiceLamp({ ...connected, status: 'connecting' })).toBe('connecting');
  expect(voiceLamp({ ...connected, microphone: 'requesting' })).toBe('connecting');
});
it('tells listening, working and speaking apart', () => {
  expect(voiceLamp(connected)).toBe('listening');
  expect(voiceLamp({ ...connected, turn: 'listening' })).toBe('listening');
  expect(voiceLamp({ ...connected, turn: 'thinking' })).toBe('working');
  expect(voiceLamp({ ...connected, turn: 'acting' })).toBe('working');
  expect(voiceLamp({ ...connected, turn: 'speaking' })).toBe('speaking');
});
it('shows an interruption or failure until the next turn starts', () => {
  expect(voiceLamp({ ...connected, interrupted: true })).toBe('interrupted');
  expect(voiceLamp({ ...connected, failed: true })).toBe('error');
  expect(voiceLamp({ ...connected, interrupted: true, turn: 'listening' })).toBe('listening');
  expect(voiceLamp({ ...connected, failed: true, turn: 'thinking' })).toBe('working');
  expect(voiceLamp({ ...connected, status: 'error' })).toBe('error');
});
