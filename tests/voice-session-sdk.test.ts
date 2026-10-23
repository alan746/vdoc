import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ClientMessage } from '@vrealtime/protocol';
import { vrtAdapter } from '../lib/infrastructure/realtime/vrt-adapter';
import { proxyVoiceSession } from '../lib/infrastructure/realtime/voice-session-proxy';
import type { RealtimeConnection } from '../lib/usecases/ports';

// Real ClientSession + real app proxy. Only the socket and upstream HTTP
// service are simulated, including a distinct SDK transport session ID.
const sockets: Socket[] = [];
class Socket extends EventTarget {
  readyState = 1;
  binaryType = 'arraybuffer';
  sent: ClientMessage[] = [];
  constructor(readonly url: string) {
    super(); sockets.push(this);
    queueMicrotask(() => this.dispatchEvent(new Event('open')));
  }
  send(data: string) {
    const message = JSON.parse(data) as ClientMessage;
    this.sent.push(message);
    if (message.type === 'hello') queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({
      v: 1, seq: 0, type: 'ready', sessionId: 'sdk-transport-1',
      input: { encoding: 'pcm16', sampleRate: 24000 }, output: { encoding: 'pcm16', sampleRate: 24000 },
      ...(sockets.length > 1 ? { resumedFrom: 0 } : {}),
    }) })));
  }
  close(code = 1000, reason = '') {
    this.readyState = 3;
    this.dispatchEvent(new CloseEvent('close', { code, reason }));
  }
}
let connection: RealtimeConnection;
let upstream: ReturnType<typeof vi.fn>;
const context = { documentId: 'doc-1', title: 'Project plan', language: 'en-US', vocabulary: ['VDoc'] };
beforeEach(() => {
  sockets.length = 0;
  vi.stubGlobal('WebSocket', Socket);
  upstream = vi.fn(async (url: string, init: RequestInit) => {
    if (init.method === 'DELETE') return new Response(null, { status: 204 });
    if (url.endsWith('/grants')) return Response.json({ token: 'renewed-grant', expiresAt: Date.now() + 60000 });
    return Response.json({ documentId: 'doc-1', sessionId: 'voice-1', realtimePath: '/v1/documents/doc-1/voice-sessions/voice-1/realtime', grant: { token: 'initial-grant', expiresAt: Date.now() + 60000 } });
  });
  vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit) => {
    const route = new URL(url).pathname;
    const action = init.method === 'DELETE' ? 'end' : route.endsWith('/grants') ? 'grant' : 'create';
    // The browser AbortSignal does not cross the HTTP boundary into a Worker.
    const { signal: _signal, ...wireInit } = init;
    const request = new Request(url, { ...wireInit, headers: { ...init.headers, Origin: location.origin } });
    return proxyVoiceSession(request, action, action === 'create' ? undefined : route.split('/')[3], {
      getUser: async () => ({ userId: 'user-1' }), serverUrl: 'https://voice.example', clientKey: 'server-only-client-key-24-characters',
      documentAccess: JSON.stringify({ 'user-1': ['doc-1'] }), fetch: upstream,
    });
  }));
});
afterEach(() => { connection?.close(); vi.unstubAllGlobals(); });

it('creates once, authenticates the real SDK, renews on reconnect and deletes the voice session on close', async () => {
  const onStatus = vi.fn();
  connection = vrtAdapter.open({ config: { url: 'wss://voice.example', sessionsUrl: '/api/voice-sessions' }, context, tools: {}, signal: new AbortController().signal, onStatus });
  await vi.waitFor(() => expect(onStatus).toHaveBeenCalledWith('connected'));
  expect(sockets[0].url).toBe('wss://voice.example/v1/documents/doc-1/voice-sessions/voice-1/realtime');
  expect(sockets[0].sent[0]).toMatchObject({ type: 'hello', auth: 'initial-grant', context });
  expect(upstream).toHaveBeenCalledTimes(1);
  sockets[0].close(1006, 'temporary disconnect');
  await vi.waitFor(() => expect(onStatus.mock.calls.filter(([status]) => status === 'connected')).toHaveLength(2));
  expect(sockets[1].url).toBe(sockets[0].url);
  expect(sockets[1].sent[0]).toMatchObject({ type: 'hello', auth: 'renewed-grant', sessionId: 'sdk-transport-1' });
  expect(upstream).toHaveBeenLastCalledWith('https://voice.example/v1/documents/doc-1/voice-sessions/voice-1/grants', expect.any(Object));
  expect(upstream.mock.calls.filter(([, init]) => init.method === 'DELETE')).toHaveLength(0);
  connection.close();
  await vi.waitFor(() => expect(upstream).toHaveBeenLastCalledWith('https://voice.example/v1/documents/doc-1/voice-sessions/voice-1', expect.objectContaining({ method: 'DELETE' })));
  expect(upstream).toHaveBeenCalledTimes(3);
  const browserMessages = JSON.stringify(sockets.flatMap(socket => socket.sent));
  expect(browserMessages).not.toContain('server-only-client-key');
  expect(browserMessages).not.toContain('documentSessionId');
});
