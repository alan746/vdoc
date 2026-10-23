import { expect, it, vi } from 'vitest';
import { POST as create } from '../app/api/voice-sessions/route';
import { POST as renew } from '../app/api/voice-sessions/[id]/grants/route';
import { DELETE as end } from '../app/api/voice-sessions/[id]/route';
import { handleVoiceSessionRequest } from '../lib/composition/voice-sessions';

vi.mock('../lib/composition/voice-sessions', () => ({ handleVoiceSessionRequest: vi.fn(async () => new Response(null, { status: 204 })) }));

it('wires all Worker routes to the same authenticated proxy and awaits dynamic route params', async () => {
  const request = new Request('https://vdoc.example/api/voice-sessions');
  await create(request);
  expect(handleVoiceSessionRequest).toHaveBeenLastCalledWith(request, 'create', undefined);
  await renew(request, { params: Promise.resolve({ id: 'voice-1' }) });
  expect(handleVoiceSessionRequest).toHaveBeenLastCalledWith(request, 'grant', 'voice-1');
  await end(request, { params: Promise.resolve({ id: 'voice-1' }) });
  expect(handleVoiceSessionRequest).toHaveBeenLastCalledWith(request, 'end', 'voice-1');
});
