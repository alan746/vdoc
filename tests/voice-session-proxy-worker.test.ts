// @vitest-environment node
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createFetchMock, Miniflare } from 'miniflare';
import { expect, it } from 'vitest';

it('forwards the voice lifecycle in workerd and rejects redirects without following them', async () => {
  // Bundle the actual proxy and inject native fetch, as the production composition
  // root does. JS mocks alone miss workerd receiver and RequestInit restrictions.
  const bundled = await build({
    stdin: {
      contents: `import { proxyVoiceSession } from './lib/infrastructure/realtime/voice-session-proxy';
        export default { fetch(request) {
          const action = new URL(request.url).searchParams.get('action');
          return proxyVoiceSession(request, action, action === 'create' ? undefined : 'voice-1', {
            getUser: async () => ({ userId: 'user-1' }),
            serverUrl: 'https://voice.example', clientKey: 'test-client-key-at-least-24-characters',
            documentAccess: JSON.stringify({ 'user-1': ['doc-1'] }), fetch,
          });
        } };`,
      resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts',
    },
    bundle: true, write: false, format: 'esm', platform: 'browser',
  });
  const mock = createFetchMock();
  mock.disableNetConnect();
  const pool = mock.get('https://voice.example');
  const base = '/v1/documents/doc-1/voice-sessions';
  const grant = { token: 'test-grant', expiresAt: Date.now() + 60000 };
  const created = { documentId: 'doc-1', sessionId: 'voice-1', grant, realtimePath: `${base}/voice-1/realtime` };
  pool.intercept({ path: base, method: 'POST' }).reply(201, JSON.stringify(created));
  pool.intercept({ path: `${base}/voice-1/grants`, method: 'POST' }).reply(201, JSON.stringify(grant));
  pool.intercept({ path: `${base}/voice-1`, method: 'DELETE' }).reply(204);
  pool.intercept({ path: base, method: 'POST' }).reply(307, '', { headers: { location: 'https://redirect.example/session' } });
  let followedRedirect = false;
  mock.get('https://redirect.example').intercept({ path: '/session', method: 'POST' }).reply(() => {
    followedRedirect = true;
    return { statusCode: 201, data: JSON.stringify(created) };
  });
  const worker = new Miniflare({
    modules: true, compatibilityDate: '2026-05-15', compatibilityFlags: ['nodejs_compat'],
    script: bundled.outputFiles[0].text, fetchMock: mock,
  });
  try {
    for (const [action, status] of [['create', 201], ['grant', 201], ['end', 204], ['create', 502]] as const) {
      const result = await worker.dispatchFetch(`https://vdoc.example/api/voice-sessions?action=${action}`, {
        method: action === 'end' ? 'DELETE' : 'POST',
        headers: { origin: 'https://vdoc.example', 'content-type': 'application/json' },
        body: JSON.stringify({ documentId: 'doc-1' }),
      });
      expect(result.status).toBe(status);
      if (status === 502) {
        expect(await result.json()).toMatchObject({ error: { code: 'VOICE_SERVICE_ERROR' } });
      } else if (status === 201) {
        expect(await result.json()).toEqual(action === 'create' ? created : grant);
      }
    }
    expect(followedRedirect).toBe(false);
    expect(mock.pendingInterceptors().filter(interceptor => interceptor.origin === 'https://voice.example')).toHaveLength(0);
  } finally {
    await worker.dispose();
  }
});
