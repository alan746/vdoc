import { createdVoiceSessionSchema } from '../lib/domain/entities/voice-session';
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
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'X-Vdoc-User-Id': 'user-1', 'X-Request-Id': expect.stringMatching(/^[0-9a-f-]{36}$/), 'Content-Type': 'application/json' },
    body: '{}', redirect: 'manual', cache: 'no-store',
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
it.each(['create', 'grant', 'end'] as const)('calls native fetch without a dependency-object receiver for %s', async action => {
  const upstream = deps.fetch;
  deps.fetch = vi.fn(async function (this: unknown, input, init) {
    // workerd rejects a native fetch called with the dependencies as `this`.
    if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
    return upstream(input, init);
  });
  const result = await run(action);
  expect(result.status).toBe(action === 'end' ? 204 : 201);
  expect(deps.fetch).toHaveBeenCalledTimes(1);
});
it.each(['../doc-2', '.', '..', 'x/y', 'x?key=secret', ''])('rejects unsafe document and session IDs: %s', async id => {
  expect((await run('create', makeRequest('create', { documentId: id }))).status).toBe(400);
  expect((await run('grant', makeRequest('grant'), id)).status).toBe(400);
  expect(deps.fetch).not.toHaveBeenCalled();
});
it('rejects injected user IDs, upstream URLs and credentials in the body', async () => {
  for (const property of ['userId', 'clientId', 'principalId', 'quotaSubject', 'serverUrl', 'clientKey', 'sessionId']) {
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
  // An ended or replaced session must not read as a network failure.
  vi.mocked(deps.fetch).mockResolvedValueOnce(Response.json({ code: 'SESSION_CLOSED' }, { status: 410 }));
  expect((await run('grant')).status).toBe(410);
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

it.each(['create', 'grant', 'end'] as const)('derives trusted user identity and a fresh request ID for %s despite forged browser headers', async action => {
  const request = makeRequest(action, { documentId: 'doc-1' }, {
    Authorization: 'Bearer browser-controlled-key', Cookie: 'private-session',
    'X-Vdoc-User-Id': 'user-2', 'X-Request-Id': 'browser-controlled-id', 'X-Client-Id': 'other-app',
  });
  const result = await run(action, request);
  expect(result.status).toBe(action === 'end' ? 204 : 201);
  const headers = new Headers(vi.mocked(deps.fetch).mock.calls[0][1]!.headers);
  expect(headers.get('authorization')).toBe(`Bearer ${key}`);
  expect(headers.get('x-vdoc-user-id')).toBe('user-1');
  expect(headers.get('x-request-id')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  for (const name of ['cookie', 'x-client-id']) expect(headers.has(name)).toBe(false);
  const body = await result.text();
  for (const secret of [key, 'browser-controlled-key', 'private-session', 'browser-controlled-id']) expect(body).not.toContain(secret);
});

it('keeps the same verified user across lifecycle calls but generates independent tracing IDs', async () => {
  await run('create'); await run('grant'); await run('end');
  const headers = vi.mocked(deps.fetch).mock.calls.map(([, init]) => new Headers(init!.headers));
  expect(headers.map(header => header.get('x-vdoc-user-id'))).toEqual(['user-1', 'user-1', 'user-1']);
  expect(new Set(headers.map(header => header.get('x-request-id'))).size).toBe(3);
});

it.each(['', ' leading-space', 'trailing-space ', 'a\nb', 'a\rb', 'trailing\n', 'trailing\r', '姓名', '/another', 'x'.repeat(129)])('rejects an invalid verified user ID before upstream I/O: %j', async userId => {
  deps.getUser = async () => ({ userId });
  for (const action of ['create', 'grant', 'end'] as const) expect((await run(action)).status).toBe(401);
  expect(deps.fetch).not.toHaveBeenCalled();
});

it.each(['concurrency', 'rate'] as const)('forwards only safe typed %s quota metadata and Retry-After', async quotaKind => {
  vi.mocked(deps.fetch).mockResolvedValueOnce(Response.json({
    code: 'QUOTA_EXCEEDED', status: 429, quotaKind, retryAfterSeconds: 42,
    detail: `private ${key}`, clientId: 'internal-app', userId: 'other-user', token: key,
  }, { status: 429, headers: { 'Retry-After': '99', 'Set-Cookie': 'secret=1', Authorization: key } }));
  const result = await run('create');
  expect(result.status).toBe(429);
  expect(result.headers.get('retry-after')).toBe('42');
  expect(result.headers.get('cache-control')).toBe('no-store');
  expect(await result.json()).toEqual({ error: { code: 'QUOTA_EXCEEDED', message: 'Your voice session limit has been reached.', quotaKind, retryAfterSeconds: 42 } });
  expect(result.headers.has('set-cookie')).toBe(false); expect(result.headers.has('authorization')).toBe(false);
});

it('retains a safe numeric Retry-After when the quota response omits the optional JSON retry value', async () => {
  vi.mocked(deps.fetch).mockResolvedValueOnce(Response.json({ code: 'QUOTA_EXCEEDED', quotaKind: 'rate' }, { status: 429, headers: { 'Retry-After': '60' } }));
  const result = await run('grant');
  expect(result.headers.get('retry-after')).toBe('60');
  expect(await result.json()).toMatchObject({ error: { code: 'QUOTA_EXCEEDED', retryAfterSeconds: 60 } });
});

it.each([0, -1, 1.5, '30', null, Number.MAX_SAFE_INTEGER + 1])('drops invalid JSON quota fields and unsafe Retry-After: %j', async retryAfterSeconds => {
  vi.mocked(deps.fetch).mockResolvedValueOnce(Response.json({ code: 'QUOTA_EXCEEDED', quotaKind: key, retryAfterSeconds }, { status: 429, headers: { 'Retry-After': 'Wed, 21 Oct 2099 07:28:00 GMT' } }));
  const result = await run('create');
  expect(result.headers.has('retry-after')).toBe(false);
  expect(await result.json()).toEqual({ error: { code: 'QUOTA_EXCEEDED', message: 'Your voice session limit has been reached.' } });
});

it('maps a quota store failure without exposing backend details and does not turn other errors into quota errors', async () => {
  vi.mocked(deps.fetch).mockResolvedValueOnce(Response.json({ code: 'QUOTA_UNAVAILABLE', detail: key, retryAfterSeconds: 60 }, { status: 503 }));
  const unavailable = await run('create');
  expect(unavailable.status).toBe(503);
  expect(unavailable.headers.get('retry-after')).toBe('60');
  expect(await unavailable.json()).toEqual({ error: { code: 'QUOTA_UNAVAILABLE', message: 'Voice limits could not be checked. Try again later.', retryAfterSeconds: 60 } });
  for (const [status, code] of [[503, 'QUOTA_EXCEEDED'], [429, 'QUOTA_UNAVAILABLE'], [429, 'UNKNOWN']] as const) {
    vi.mocked(deps.fetch).mockResolvedValueOnce(Response.json({ code, detail: key }, { status }));
    const result = await run('create');
    expect(result.status).toBe(status);
    expect(await result.json()).toMatchObject({ error: { code: 'VOICE_SERVICE_ERROR' } });
  }
});

it('bounds malformed or oversized quota problems and preserves only the safe status', async () => {
  for (const body of ['{', JSON.stringify({ code: 'QUOTA_EXCEEDED', detail: key.repeat(200) })]) {
    vi.mocked(deps.fetch).mockResolvedValueOnce(new Response(body, { status: 429 }));
    const result = await run('create');
    expect(result.status).toBe(429);
    expect(await result.json()).toMatchObject({ error: { code: 'VOICE_SERVICE_ERROR' } });
  }
});

it('passes a quota outage retry hint using the same safe JSON and header rules', async () => {
  vi.mocked(deps.fetch).mockResolvedValueOnce(Response.json({ code: 'QUOTA_UNAVAILABLE', detail: key }, { status: 503, headers: { 'Retry-After': '1' } }));
  const result = await run('grant');
  expect(result.status).toBe(503);
  expect(result.headers.get('retry-after')).toBe('1');
  expect(await result.json()).toEqual({ error: { code: 'QUOTA_UNAVAILABLE', message: 'Voice limits could not be checked. Try again later.', retryAfterSeconds: 1 } });
});

it('isolates authenticated local voice rooms from cloud documents and other accounts on every lifecycle request', async () => {
  deps.allowLocalDocuments = true;
  deps.authorizeDocument = vi.fn(async () => null);
  deps.fetch = vi.fn(async (input, init) => {
    if (init?.method === 'DELETE') return new Response(null, { status: 204 });
    if (String(input).endsWith('/grants')) return Response.json(grant);
    const id = new URL(String(input)).pathname.split('/')[3];
    return Response.json({ ...created, documentId: id, realtimePath: `/v1/documents/${id}/voice-sessions/voice-1/realtime` });
  });
  const body = { documentId: 'doc-1', workspace: 'local' };
  const result = await run('create', makeRequest('create', body));
  expect(result.status).toBe(201);
  const local = createdVoiceSessionSchema.parse(await result.json());
  expect(local.documentId).toBe('doc-1');
  expect(local.transportDocumentId).toMatch(/^local_[a-f0-9]{64}$/);
  for (const action of ['grant', 'end'] as const) {
    expect((await run(action, makeRequest(action, body))).status).toBe(action === 'end' ? 204 : 201);
    expect(vi.mocked(deps.fetch).mock.lastCall![0]).toContain(`/documents/${local.transportDocumentId}/`);
    expect(vi.mocked(deps.fetch).mock.lastCall![1]!.headers).toMatchObject({ 'X-Vdoc-User-Id': 'user-1' });
  }
  expect(deps.authorizeDocument).not.toHaveBeenCalled();
  expect((await run('create')).status).toBe(403); // local mode never grants cloud ownership
  deps.getUser = vi.fn(async () => ({ userId: 'user-2' }));
  const other = createdVoiceSessionSchema.parse(await (await run('create', makeRequest('create', body))).json());
  expect(other.transportDocumentId).not.toBe(local.transportDocumentId);
  deps.getUser = vi.fn(async () => null);
  for (const action of ['create', 'grant', 'end'] as const)
    expect((await run(action, makeRequest(action, body))).status).toBe(401);
});
it('requires opt-in for local voice and returns local mode only after authenticated discovery', async () => {
  const request = () => new Request('https://vdoc.example/api/voice-sessions?documentId=doc-1&workspace=local');
  expect((await proxyVoiceSession(request(), 'check', undefined, deps)).status).toBe(403);
  deps.allowLocalDocuments = true;
  const result = await proxyVoiceSession(request(), 'check', undefined, deps);
  expect(await result.json()).toMatchObject({ workspace: 'local', audio: true });
  expect(deps.fetch).not.toHaveBeenCalled();
  expect((await run('create', makeRequest('create', { documentId: 'doc-1', workspace: 'unknown' }))).status).toBe(400);
  deps.getUser = vi.fn(async () => null);
  expect((await proxyVoiceSession(request(), 'check', undefined, deps)).status).toBe(401);
});
