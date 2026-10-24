import { expect, it } from 'vitest';
import { agentStatus } from '../components/editor/realtime/agent-status';

const connected = { checking: false, status: 'connected', microphone: 'on', turn: 'idle', writing: false } as const;

it('is idle until a session connects', () => {
  expect(agentStatus({ ...connected, status: 'disconnected' })).toBe('idle');
  expect(agentStatus({ ...connected, checking: true })).toBe('idle');
  expect(agentStatus({ ...connected, status: 'connecting' })).toBe('connecting');
  expect(agentStatus({ ...connected, status: 'error' })).toBe('error');
});
it('tells listening, thinking, writing and speaking apart', () => {
  expect(agentStatus(connected)).toBe('listening');
  expect(agentStatus({ ...connected, turn: 'thinking' })).toBe('thinking');
  expect(agentStatus({ ...connected, turn: 'acting' })).toBe('thinking');
  expect(agentStatus({ ...connected, turn: 'acting', writing: true })).toBe('writing');
  expect(agentStatus({ ...connected, turn: 'speaking' })).toBe('speaking');
});
