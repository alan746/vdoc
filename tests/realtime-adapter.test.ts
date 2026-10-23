import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { vrtAdapter, validateRealtimeConfig } from '../lib/infrastructure/realtime/vrt-adapter';
import { readRealtimeConfig, REALTIME_CONFIG_KEY } from '../lib/composition/realtime';
import type { RealtimeConfig } from '../lib/usecases/ports';

const fake = vi.hoisted(() => ({ sessions: [] as { options: { auth: () => Promise<string>; audio: unknown; context: unknown }; handlers: Record<string, (event?: unknown) => void>; start: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn>; interrupt: ReturnType<typeof vi.fn>; sendText: ReturnType<typeof vi.fn> }[] }));
vi.mock('@vrealtime/client', () => ({ ClientSession: class {
  handlers: Record<string, (event?: unknown) => void> = {}; connected = true;
  start = vi.fn(() => new Promise<void>(() => {})); close = vi.fn(async () => {});
  interrupt = vi.fn(); sendText = vi.fn();
  constructor(_url: string, readonly options: { auth: () => Promise<string>; audio: unknown; context: unknown }) { fake.sessions.push(this); }
  on(name: string, listener: (event?: unknown) => void) { this.handlers[name] = listener; return () => { delete this.handlers[name]; }; }
} }));
const config: RealtimeConfig = { url: 'ws://localhost:8790', tokenUrl: '/api/realtime-token' };
const open = (signal = new AbortController().signal) => vrtAdapter.open({ config, docId: 'doc-1', sessionId: 'edit-1', tools: {}, signal, onStatus: vi.fn() });
beforeEach(() => { fake.sessions.length = 0; localStorage.clear(); });
afterEach(() => vi.unstubAllGlobals());
it('is disabled without explicit local configuration, including with page query parameters', () => {
  history.replaceState(null, '', '/?realtime=wss://evil.example');
  expect(readRealtimeConfig()).toBeNull(); expect(fake.sessions).toHaveLength(0);
  history.replaceState(null, '', '/');
});
it('reads local configuration without accepting remote plaintext or URL tokens', () => {
  localStorage.setItem(REALTIME_CONFIG_KEY, JSON.stringify(config)); expect(readRealtimeConfig()?.url).toBe('ws://localhost:8790/');
  for (const url of ['ws://example.com', 'https://example.com', 'wss://example.com?token=secret', 'wss://u:p@example.com', 'wss://example.com#token'])
    expect(() => validateRealtimeConfig({ ...config, url }, location.origin)).toThrow();
  expect(() => validateRealtimeConfig({ ...config, tokenUrl: 'https://evil.example/token' }, location.origin)).toThrow();
});
it('fetches a fresh document-scoped token for every SDK auth callback', async () => {
  const fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'one' }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'two' }) });
  vi.stubGlobal('fetch', fetch); const connection = open(); const session = fake.sessions[0];
  expect(session.options.audio).toBe(false);
  expect(session.options.context).toEqual({ docId: 'doc-1', documentSessionId: 'edit-1' });
  expect(await session.options.auth()).toBe('one'); expect(await session.options.auth()).toBe('two');
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'POST', credentials: 'same-origin', body: JSON.stringify({ docId: 'doc-1', sessionId: 'edit-1' }), redirect: 'error' });
  connection.close();
});
it('closes a pending handshake immediately on unmount, without waiting for ready', () => {
  const lifetime = new AbortController(); const connection = open(lifetime.signal); lifetime.abort(); connection.close();
  expect(fake.sessions[0].close).toHaveBeenCalledTimes(1); expect(fake.sessions[0].interrupt).toHaveBeenCalledTimes(1);
  connection.sendText('late'); expect(fake.sessions[0].sendText).not.toHaveBeenCalled();
});
it('aborts pending auth and ignores a token returned after document teardown', async () => {
  let resolve!: (result: unknown) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise(r => { resolve = r; })));
  const connection = open(); const token = fake.sessions[0].options.auth(); connection.close();
  resolve({ ok: true, json: async () => ({ token: 'late' }) }); await expect(token).rejects.toThrow('closed');
});
it('rejects invalid or denied tokens and does not start an already-aborted lifecycle', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ token: '' }) })));
  const connection = open(); await expect(fake.sessions[0].options.auth()).rejects.toThrow('invalid token'); connection.close();
  const lifetime = new AbortController(); lifetime.abort(); open(lifetime.signal); expect(fake.sessions[1].start).not.toHaveBeenCalled();
});
it('forwards Stop/Esc and text exclusively through the SDK', () => {
  const connection = open(); connection.interrupt('keyboard'); connection.sendText('hello');
  expect(fake.sessions[0].interrupt).toHaveBeenCalledWith('keyboard'); expect(fake.sessions[0].sendText).toHaveBeenCalledWith('hello'); connection.close();
});
it('keeps SDK imports inside the infrastructure adapter', () => {
  const files = (root: string): string[] => readdirSync(root, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(root, entry.name)) : /\.[tj]sx?$/.test(entry.name) ? [join(root, entry.name)] : []);
  const imports = ['app', 'components', 'lib'].flatMap(files).filter(file => /from ['"]@vrealtime\//.test(readFileSync(file, 'utf8')));
  expect(imports).toEqual(['lib/infrastructure/realtime/vrt-adapter.ts']);
});
it('forwards provider turn state, calls, results and interrupts as display-only activity, until closed', () => {
  const onActivity = vi.fn(), lifetime = new AbortController();
  vrtAdapter.open({ config, docId: 'doc-1', sessionId: 'edit-1', tools: {}, signal: lifetime.signal, onStatus: vi.fn(), onActivity });
  const handlers = fake.sessions[0].handlers;
  handlers.state({ state: 'thinking', turnId: 't1', epoch: 1 });
  handlers['tool.call']({ callId: 'c1', name: 'apply_document_operations', arguments: { a: 1 }, turnId: 't1', epoch: 1 });
  handlers['tool.result']({ callId: 'c1', name: 'apply_document_operations', turnId: 't1', epoch: 1, result: { ok: false, code: 'INTERRUPTED', message: 'x' } });
  handlers.interrupted({ epoch: 1, source: 'local' });
  expect(onActivity.mock.calls.map(call => call[0])).toEqual([
    { type: 'turn', state: 'thinking', turnId: 't1' },
    { type: 'call', callId: 'c1', name: 'apply_document_operations', arguments: { a: 1 } },
    { type: 'result', callId: 'c1', ok: false },
    { type: 'interrupted' },
  ]);
  lifetime.abort();
  expect(fake.sessions[0].handlers.state).toBeUndefined();
});
