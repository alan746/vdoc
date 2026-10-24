import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';
import { vrtAdapter, validateRealtimeConfig } from '../lib/infrastructure/realtime/vrt-adapter';
import * as browserAudio from '../lib/infrastructure/realtime/browser-audio';
import { VoiceConnectionError } from '../lib/infrastructure/realtime/voice-errors';
import { loadRealtimeConfig } from '../lib/composition/realtime';
import type { RealtimeConfig, RealtimeConnection, RealtimePort } from '../lib/usecases/ports';

const fake = vi.hoisted(() => ({ sessions: [] as { url: string; options: { auth: () => Promise<string>; audio: unknown; context: unknown }; handlers: Record<string, (event?: unknown) => void>; start: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn>; interrupt: ReturnType<typeof vi.fn>; sendText: ReturnType<typeof vi.fn> }[] }));
vi.mock('@vrealtime/client', () => ({ CaptureResampler: class {}, createSpeaker: vi.fn(), ClientSession: class {
  handlers: Record<string, (event?: unknown) => void> = {}; connected = true;
  start = vi.fn(async () => {}); close = vi.fn(async () => {});
  interrupt = vi.fn(); sendText = vi.fn();
  constructor(readonly url: string, readonly options: { auth: () => Promise<string>; audio: unknown; context: unknown }) { fake.sessions.push(this); }
  on(name: string, listener: (event?: unknown) => void) { this.handlers[name] = listener; return () => { delete this.handlers[name]; }; }
} }));
const config: RealtimeConfig = { url: 'ws://localhost:8790', sessionsUrl: '/api/voice-sessions' };
const context = { documentId: 'doc-1', title: 'My document', language: 'en-US', vocabulary: ['VDoc'] };
const grant = (token = 'initial') => ({ token, expiresAt: Date.now() + 60000 });
const created = () => ({ documentId: 'doc-1', sessionId: 'voice-1', grant: grant(), realtimePath: '/v1/documents/doc-1/voice-sessions/voice-1/realtime' });
const response = (body: unknown) => ({ ok: true, json: async () => body });
const handles: RealtimeConnection[] = [];
const open = (extra: Partial<Parameters<RealtimePort['open']>[0]> = {}) => {
  const handle = vrtAdapter.open({ config, context, tools: {}, signal: new AbortController().signal, onStatus: vi.fn(), ...extra });
  handles.push(handle); return handle;
};
const started = async () => { await vi.waitFor(() => expect(fake.sessions).toHaveLength(1)); return fake.sessions[0]; };
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fake.sessions.length = 0; handles.length = 0; localStorage.clear();
  fetchMock = vi.fn(async (url: string, init: RequestInit) => init.method === 'DELETE'
    ? { ok: true } : response(url.endsWith('/grants') ? grant('renewed') : created()));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { for (const handle of handles) handle.close(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('discovers configuration from the authenticated endpoint and ignores localStorage and URL overrides', async () => {
  history.replaceState(null, '', '/?realtime=wss://evil.example');
  localStorage.setItem('vdoc.realtime.v2', JSON.stringify({ url: 'wss://evil.example' }));
  fetchMock.mockResolvedValueOnce(response({ ...config, audio: true }));
  expect(await loadRealtimeConfig('doc-1', new AbortController().signal)).toMatchObject({ url: 'ws://localhost:8790/', audio: true });
  expect(fetchMock).toHaveBeenCalledWith('/api/voice-sessions?documentId=doc-1', expect.objectContaining({ credentials: 'same-origin', cache: 'no-store' }));
  expect(fake.sessions).toHaveLength(0); history.replaceState(null, '', '/');
});
it('keeps the origin/credential restrictions and validates context preferences', () => {
  for (const url of ['ws://example.com', 'https://example.com', 'wss://example.com?token=secret', 'wss://u:p@example.com', 'wss://example.com#token', 'wss://example.com/old-session'])
    expect(() => validateRealtimeConfig({ ...config, url }, location.origin)).toThrow();
  expect(() => validateRealtimeConfig({ ...config, sessionsUrl: 'https://evil.example/sessions' }, location.origin)).toThrow();
  expect(() => validateRealtimeConfig({ ...config, vocabulary: ['x'.repeat(41)] }, location.origin)).toThrow();
});
it('creates the voice session before constructing the SDK and uses the initial grant exactly once', async () => {
  open(); expect(fake.sessions).toHaveLength(0);
  const session = await started();
  expect(session.url).toBe('ws://localhost:8790/v1/documents/doc-1/voice-sessions/voice-1/realtime');
  expect(session.options.audio).toBe(false); expect(session.options.context).toEqual(context);
  expect(session.options.context).not.toHaveProperty('documentSessionId');
  expect(await session.options.auth()).toBe('initial'); expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0]).toEqual([`${location.origin}/api/voice-sessions`, expect.objectContaining({
    method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', body: JSON.stringify({ documentId: 'doc-1' }),
  })]);
  expect(await session.options.auth()).toBe('renewed'); expect(await session.options.auth()).toBe('renewed');
  expect(fetchMock.mock.calls.slice(1).map(call => call[0])).toEqual([
    `${location.origin}/api/voice-sessions/voice-1/grants`, `${location.origin}/api/voice-sessions/voice-1/grants`,
  ]);
});
it('renews the initial grant if it expires before the first auth callback', async () => {
  fetchMock.mockResolvedValueOnce(response({ ...created(), grant: { token: 'old', expiresAt: Date.now() - 1 } }));
  open(); const session = await started();
  expect(await session.options.auth()).toBe('renewed'); expect(fetchMock).toHaveBeenCalledTimes(2);
});
it.each(['https://evil.example/realtime', '//evil.example/realtime', '/v1/documents/other/voice-sessions/voice-1/realtime', '/v1/documents/doc-1/voice-sessions/voice-1/realtime?token=leak'])('rejects an unexpected realtimePath: %s', async realtimePath => {
  fetchMock.mockResolvedValueOnce(response({ ...created(), realtimePath }));
  const onStatus = vi.fn(); open({ onStatus });
  await vi.waitFor(() => expect(onStatus).toHaveBeenCalledWith('error', expect.any(String)));
  expect(fake.sessions).toHaveLength(0);
  expect(fetchMock).toHaveBeenLastCalledWith(`${location.origin}/api/voice-sessions/voice-1`, expect.objectContaining({ method: 'DELETE' }));
});
it('closes a pending handshake immediately and deletes the voice session once with a live cleanup signal', async () => {
  const lifetime = new AbortController(); const connection = open({ signal: lifetime.signal }); const session = await started();
  lifetime.abort(); connection.close();
  expect(session.close).toHaveBeenCalledTimes(1); expect(session.interrupt).toHaveBeenCalledTimes(1);
  const deletion = fetchMock.mock.calls.find(call => call[1].method === 'DELETE')!;
  expect(deletion).toEqual([`${location.origin}/api/voice-sessions/voice-1`, expect.objectContaining({ keepalive: true, body: JSON.stringify({ documentId: 'doc-1' }) })]);
  expect(deletion[1].signal.aborted).toBe(false);
  expect(fetchMock.mock.calls.filter(call => call[1].method === 'DELETE')).toHaveLength(1);
  connection.sendText('late'); expect(session.sendText).not.toHaveBeenCalled();
});
it('cleans up a creation that finishes after the document has closed, without starting the SDK', async () => {
  let resolve!: (value: unknown) => void;
  fetchMock.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  const onStatus = vi.fn(); const connection = open({ onStatus }); connection.close();
  expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(false);
  resolve(response(created()));
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(fetchMock.mock.calls[1][1].method).toBe('DELETE'); expect(fake.sessions).toHaveLength(0);
  expect(onStatus.mock.calls).toEqual([['connecting']]);
});
it('aborts a pending grant renewal and rejects a late grant after close', async () => {
  const connection = open(); const session = await started(); await session.options.auth();
  let resolve!: (value: unknown) => void;
  fetchMock.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  const token = session.options.auth(); connection.close();
  expect(fetchMock.mock.calls[1][1].signal.aborted).toBe(true);
  resolve(response(grant('late'))); await expect(token).rejects.toThrow('closed');
});
it('does not allocate a session for an already-aborted document', () => {
  const lifetime = new AbortController(); lifetime.abort(); open({ signal: lifetime.signal });
  expect(fetchMock).not.toHaveBeenCalled(); expect(fake.sessions).toHaveLength(0);
});
it('does not construct a connection after denied creation and never exposes response details', async () => {
  fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ secret: 'upstream credential' }) });
  const onStatus = vi.fn(); open({ onStatus });
  await vi.waitFor(() => expect(onStatus).toHaveBeenCalledWith('error', expect.any(String)));
  expect(fake.sessions).toHaveLength(0); expect(JSON.stringify(onStatus.mock.calls)).not.toContain('credential');
});
it.each([{ token: '', expiresAt: Date.now() + 60000 }, { token: 'expired', expiresAt: 1 }])('rejects invalid or expired renewal grants', async invalidGrant => {
  open(); const session = await started(); await session.options.auth();
  fetchMock.mockResolvedValueOnce(response(invalidGrant));
  await expect(session.options.auth()).rejects.toThrow();
});
it('forwards Stop/Esc, text and activity events, and ends a terminally closed session', async () => {
  const onActivity = vi.fn(); const connection = open({ onActivity }); const session = await started();
  connection.interrupt('keyboard'); connection.sendText('hello');
  expect(session.interrupt).toHaveBeenCalledWith('keyboard'); expect(session.sendText).toHaveBeenCalledWith('hello');
  session.handlers.state({ state: 'acting', turnId: 'turn-1' });
  session.handlers['tool.call']({ callId: 'call', name: 'apply', arguments: {} });
  session.handlers.transcript({ role: 'user', itemId: 'speech-1', text: '加一个表格', final: true });
  session.handlers['tool.result']({ callId: 'call', name: 'apply', result: { ok: false, code: 'FAILED', message: 'Invalid operation' } });
  session.handlers.interrupted();
  expect(onActivity.mock.calls.map(call => call[0])).toEqual([
    { type: 'turn', state: 'acting', turnId: 'turn-1' }, { type: 'call', callId: 'call', name: 'apply', arguments: {} },
    { type: 'transcript', role: 'user', itemId: 'speech-1', text: '加一个表格', final: true },
    { type: 'result', callId: 'call', name: 'apply', ok: false, code: 'FAILED', message: 'Invalid operation' }, { type: 'interrupted' },
  ]);
  session.handlers.closed();
  expect(fetchMock).toHaveBeenLastCalledWith(`${location.origin}/api/voice-sessions/voice-1`, expect.objectContaining({ method: 'DELETE' }));
});
it('keeps SDK imports inside the infrastructure adapter', () => {
  const files = (root: string): string[] => readdirSync(root, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(root, entry.name)) : /\.[tj]sx?$/.test(entry.name) ? [join(root, entry.name)] : []);
  const imports = ['app', 'components', 'lib'].flatMap(files).filter(file => /from ['"]@vrealtime\//.test(readFileSync(file, 'utf8')));
  expect(imports.map(file => file.split(sep).join('/'))).toEqual(['lib/infrastructure/realtime/vrt-adapter.ts']);
});

it.each([401, 402, 403, 409, 410, 429, 503])('preserves actionable HTTP %s errors on creation and renewal', async status => {
  const onStatus = vi.fn();
  fetchMock.mockResolvedValueOnce({ ok: false, status, json: async () => ({ error: { message: 'secret upstream detail' } }) });
  open({ onStatus });
  await vi.waitFor(() => expect(onStatus).toHaveBeenCalledWith('error', expect.any(String)));
  const message = onStatus.mock.calls.at(-1)![1];
  expect(message).not.toContain('secret');
  if (status === 402 || status === 429) expect(message).toContain('quota');
  if (status === 410) expect(message).toMatch(/ended.*Connect again/);
  onStatus.mockClear(); open({ onStatus });
  const session = await started(); await session.options.auth();
  fetchMock.mockResolvedValueOnce({ ok: false, status, json: async () => ({}) });
  await expect(session.options.auth()).rejects.toThrow(message);
  session.handlers.error({ code: 'AUTH_FAILED', recoverable: false, message: 'secret' });
  expect(onStatus).toHaveBeenLastCalledWith('error', message);
  expect(session.close).toHaveBeenCalledOnce();
});
it('retains terminal quota errors instead of replacing them with a disconnected status', async () => {
  const onStatus = vi.fn(); open({ onStatus }); const session = await started();
  const closed = session.handlers.closed;
  session.handlers.error({ code: 'QUOTA_EXCEEDED', message: 'secret', recoverable: false });
  closed();
  expect(onStatus).toHaveBeenLastCalledWith('error', expect.stringContaining('quota'));
  expect(session.close).toHaveBeenCalledOnce();
});

it('surfaces microphone denial before allocating a billable voice session', async () => {
  vi.spyOn(browserAudio, 'prepareBrowserAudio').mockRejectedValueOnce(new VoiceConnectionError('Microphone permission was denied. Allow access and retry.'));
  const onStatus = vi.fn(); open({ config: { ...config, audio: true }, onStatus });
  await vi.waitFor(() => expect(onStatus).toHaveBeenCalledWith('error', expect.stringContaining('permission was denied')));
  expect(fetchMock).not.toHaveBeenCalled(); expect(fake.sessions).toHaveLength(0);
});
it('cancels pending audio initialization without allocating a late voice session', async () => {
  let resolve!: (audio: Awaited<ReturnType<typeof browserAudio.prepareBrowserAudio>>) => void;
  let signal: AbortSignal | undefined;
  vi.spyOn(browserAudio, 'prepareBrowserAudio').mockImplementationOnce(options => {
    signal = options.signal; return new Promise(done => { resolve = done; });
  });
  const onStatus = vi.fn(); const connection = open({ config: { ...config, audio: true }, onStatus });
  connection.close(); expect(signal!.aborted).toBe(true);
  resolve({ stop: vi.fn(async () => {}), input: vi.fn(), output: { enqueue: vi.fn(), flush: vi.fn(async () => ({})), close: vi.fn(async () => {}) } });
  await Promise.resolve(); await Promise.resolve();
  expect(fetchMock).not.toHaveBeenCalled(); expect(onStatus.mock.calls).toEqual([['connecting']]);
});

it('carries local scope through discovery, create, renewal and cleanup', async () => {
  fetchMock.mockResolvedValueOnce(response({ ...config, workspace: 'local' }));
  const local = await loadRealtimeConfig('doc-1', new AbortController().signal, 'local');
  expect(fetchMock.mock.calls[0][0]).toBe('/api/voice-sessions?documentId=doc-1&workspace=local');
  expect(local.workspace).toBe('local');
  const connection = open({ config: local }); const session = await started();
  await session.options.auth(); await session.options.auth(); connection.close();
  for (const [, init] of fetchMock.mock.calls.slice(1))
    expect(JSON.parse(init.body)).toEqual({ documentId: 'doc-1', workspace: 'local' });
});
