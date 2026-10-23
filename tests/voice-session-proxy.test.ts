import { beforeEach, expect, it, vi } from 'vitest';
import { proxyVoiceSession, type VoiceSessionAction, type VoiceSessionProxyDependencies } from '../lib/infrastructure/realtime/voice-session-proxy';

const key = 'test-server-client-key-at-least-24';
const grant = { token: 'short-lived-grant', expiresAt: Date.now() + 60000 };
const created = { documentId: 'doc-1', sessionId: 'voice-1', grant, realtimePath: '/v1/documents/doc-1/voice-sessions/voice-1/realtime' };
let deps: VoiceSessionProxyDependencies;
const makeRequest = (action: VoiceSessionAction, body: unknown = { documentId: 'doc-1' }, headers: Record<string, string> = {}) => new Request('https://vdoc.example/api/voice-sessions', {
  method: action === 'end' ? 'DELETE' : 'POST', body: JSON.stringify(body),
  headers: { Origin: 'https://vdoc.example', 'Content-Type': 'application/json', ...headers },
});
const run = (action: VoiceSessionAction, request = makeRequest(action), sessionId = 'voice-1') => proxyVoiceSession(request, action, action === 'create' ? undefined : sessionId, deps);
beforeEach(() => {
  deps = {
    getUser: vi.fn(async () => ({ userId: 'user-1' })), serverUrl: 'https://voice.example', clientKey: key,
    documentAccess: JSON.stringify({ 'user-1': ['doc-1'], 'user-2': ['doc-2'] }),
    fetch: vi.fn(async (url, init) => init?.method === 'DELETE' ? new Response(null, { status: 204 })
      : Response.json(String(url).endsWith('/grants') ? grant : { ...created, internal: 'do-not-forward' }, { status: 201 })),
  };
});
it.each(['create', 'grant', 'end'] as const)('requires a signed-in user before %s or any upstream request', async action => {
  deps.getUser = vi.fn(async () => null);
  expect((await run(action)).status).toBe(401); expect(deps.fetch).not.toHaveBeenCalled();
});
it.each(['create', 'grant', 'end'] as const)('checks document access on every %s request', async action => {
  deps.getUser = vi.fn(async () => ({ userId: 'user-2' }));
  expect((await run(action)).status).toBe(403); expect(deps.fetch).not.toHaveBeenCalled();
  deps.getUser = vi.fn(async () => ({ userId: 'unknown' }));
  expect((await run(action)).status).toBe(403); expect(deps.fetch).not.toHaveBeenCalled();
});
it('fails closed when secrets or the access list are missing or invalid', async () => {
  for (const patch of [{ documentAccess: undefined }, { documentAccess: '{' }, { documentAccess: '{}' }, { clientKey: undefined }, { clientKey: 'short' }, { serverUrl: 'http://voice.example' }, { serverUrl: 'https://user:pass@voice.example' }, { serverUrl: 'https://voice.example/path' }]) {
    const result = await proxyVoiceSession(makeRequest('create'), 'create', undefined, { ...deps, ...patch });
    expect([403, 503]).toContain(result.status);
  }
  expect(deps.fetch).not.toHaveBeenCalled();
});
it.each(['https://evil.example', 'https://sub.vdoc.example', 'null', ''])('rejects a foreign or absent Origin: %s', async origin => {
  expect((await run('create', makeRequest('create', undefined, { Origin: origin }))).status).toBe(403);
  expect(deps.fetch).not.toHaveBeenCalled(); expect(deps.getUser).not.toHaveBeenCalled();
});
it('rejects cross-site requests even when the Origin header matches', async () => {
  expect((await run('create', makeRequest('create', undefined, { 'Sec-Fetch-Site': 'cross-site' }))).status).toBe(403);
  expect(deps.fetch).not.toHaveBeenCalled();
});
it('forwards creation with only the server key and returns only the public session fields', async () => {
  const result = await run('create');
  expect(result.status).toBe(201); expect(result.headers.get('cache-control')).toBe('no-store');
  expect(await result.json()).toEqual(created);
  expect(deps.fetch).toHaveBeenCalledWith('https://voice.example/v1/documents/doc-1/voice-sessions', expect.objectContaining({
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: '{}', redirect: 'error', cache: 'no-store',
  }));
  const headers = vi.mocked(deps.fetch).mock.calls[0][1]!.headers;
  expect(headers).not.toHaveProperty('cookie');
});
it('renews and ends within the authorized document path, not the editing session', async () => {
  const renewal = await run('grant'); expect(renewal.status).toBe(201); expect(await renewal.json()).toEqual(grant);
  expect(deps.fetch).toHaveBeenLastCalledWith('https://voice.example/v1/documents/doc-1/voice-sessions/voice-1/grants', expect.objectContaining({ method: 'POST' }));
  const ended = await run('end'); expect(ended.status).toBe(204); expect(await ended.text()).toBe('');
  expect(deps.fetch).toHaveBeenLastCalledWith('https://voice.example/v1/documents/doc-1/voice-sessions/voice-1', expect.objectContaining({ method: 'DELETE' }));
  deps.documentAccess = JSON.stringify({ 'user-1': [] });
  expect((await run('grant')).status).toBe(403); expect((await run('end')).status).toBe(403);
  expect(deps.fetch).toHaveBeenCalledTimes(2);
});
it.each(['../doc-2', '.', '..', 'x/y', 'x?key=secret', ''])('rejects unsafe document and session IDs: %s', async id => {
  expect((await run('create', makeRequest('create', { documentId: id }))).status).toBe(400);
  expect((await run('grant', makeRequest('grant'), id)).status).toBe(400);
  expect(deps.fetch).not.toHaveBeenCalled();
});
it('rejects injected user IDs, upstream URLs and credentials in the body', async () => {
  for (const property of ['userId', 'serverUrl', 'clientKey', 'sessionId']) {
    expect((await run('create', makeRequest('create', { documentId: 'doc-1', [property]: 'spoofed' }))).status).toBe(400);
  }
  expect(deps.fetch).not.toHaveBeenCalled();
});
it('requires bounded JSON, including when Content-Length is absent', async () => {
  expect((await run('create', makeRequest('create', undefined, { 'Content-Type': 'text/plain' }))).status).toBe(415);
  expect((await run('create', makeRequest('create', { documentId: 'x'.repeat(5000) }))).status).toBe(413);
  const bad = new Request('https://vdoc.example/api/voice-sessions', { method: 'POST', headers: { Origin: 'https://vdoc.example', 'Content-Type': 'application/json' }, body: '{' });
  expect((await run('create', bad)).status).toBe(400); expect(deps.fetch).not.toHaveBeenCalled();
});
it('never relays upstream errors, credentials, redirects or mismatched session paths', async () => {
  vi.mocked(deps.fetch).mockResolvedValueOnce(Response.json({ error: key }, { status: 401 }));
  let result = await run('create'); expect(result.status).toBe(502); expect(await result.text()).not.toContain(key);
  vi.mocked(deps.fetch).mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: 'https://evil.example' } }));
  expect((await run('create')).status).toBe(502);
  for (const patch of [{ documentId: 'doc-2' }, { realtimePath: '//evil.example/realtime' }, { grant: { token: '', expiresAt: 0 } }]) {
    vi.mocked(deps.fetch).mockResolvedValueOnce(Response.json({ ...created, ...patch }));
    result = await run('create'); expect(result.status).toBe(502);
  }
});
it('preserves safe upstream status categories and hides network error details', async () => {
  vi.mocked(deps.fetch).mockResolvedValueOnce(Response.json({ code: 'NOT_FOUND' }, { status: 404 }));
  expect((await run('grant')).status).toBe(404);
  vi.mocked(deps.fetch).mockRejectedValueOnce(new Error(key));
  const result = await run('grant'); expect(result.status).toBe(502); expect(await result.text()).not.toContain(key);
});

it.each(['create', 'grant', 'end'] as const)('fails closed on missing database ownership for %s', async action => {
  deps.authorizeDocument = vi.fn(async () => null);
  expect((await run(action)).status).toBe(403);
  expect(deps.fetch).not.toHaveBeenCalled();
  deps.authorizeDocument = vi.fn(async () => { throw new Error('postgres://private'); });
  const result = await run(action);
  expect(result.status).toBe(503);
  expect(await result.text()).not.toContain('postgres:');
  expect(deps.fetch).not.toHaveBeenCalled();
});

it('discovers the public voice origin only for authenticated, authorized cloud documents', async () => {
  const request = new Request('https://vdoc.example/api/voice-sessions?documentId=doc-1');
  const check = () => proxyVoiceSession(request, 'check', undefined, deps);
  const result = await check();
  expect(result.status).toBe(200); expect(result.headers.get('cache-control')).toBe('no-store');
  expect(await result.json()).toEqual({ url: 'wss://voice.example', sessionsUrl: '/api/voice-sessions', audio: true });
  expect(deps.fetch).not.toHaveBeenCalled();
  deps.authorizeDocument = vi.fn(async () => null);
  expect((await check()).status).toBe(403);
  deps.getUser = vi.fn(async () => null);
  expect((await check()).status).toBe(401);
});
it('does not disclose configuration to cross-site discovery or invalid documents', async () => {
  for (const headers of [new Headers({ Origin: 'https://evil.example' }), new Headers({ 'Sec-Fetch-Site': 'cross-site' })]) {
    const result = await proxyVoiceSession(new Request('https://vdoc.example/api/voice-sessions?documentId=doc-1', { headers }), 'check', undefined, deps);
    expect(result.status).toBe(403);
  }
  expect((await proxyVoiceSession(new Request('https://vdoc.example/api/voice-sessions'), 'check', undefined, deps)).status).toBe(400);
  expect(deps.fetch).not.toHaveBeenCalled();
});
it.each([402, 429])('preserves quota/limit HTTP %s without exposing upstream details', async status => {
  vi.mocked(deps.fetch).mockResolvedValueOnce(Response.json({ secret: key }, { status }));
  const result = await run('create');
  expect(result.status).toBe(status); expect(await result.text()).not.toContain(key);
});
