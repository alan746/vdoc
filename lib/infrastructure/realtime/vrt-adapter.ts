import { ClientSession } from '@vrealtime/client';
import { z } from 'zod';
import { createdVoiceSessionSchema, voiceDocumentContextSchema, voiceGrantSchema, voiceLanguageSchema, voiceRealtimePath, voiceResourceIdSchema, voiceVocabularySchema } from '../../domain/entities/voice-session';
import type { RealtimeActivity, RealtimeConfig, RealtimePort } from '../../usecases/ports';

const loopback = (host: string) => host === 'localhost' || host === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(host);
const configSchema = z.object({ url: z.string(), sessionsUrl: z.string(), audio: z.boolean().optional(), language: voiceLanguageSchema.optional(), vocabulary: voiceVocabularySchema.optional() });
/** Configuration is supplied locally, never derived from a document or link. */
export function validateRealtimeConfig(input: RealtimeConfig, pageOrigin: string): RealtimeConfig {
  const config = configSchema.parse(input);
  const url = new URL(config.url);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || !(url.protocol === 'wss:' || (url.protocol === 'ws:' && loopback(url.hostname))))
    throw new Error('Use a wss:// service origin or a loopback ws:// origin, without a path, credentials or query parameters.');
  const sessionsUrl = new URL(config.sessionsUrl, pageOrigin);
  if (sessionsUrl.username || sessionsUrl.password || sessionsUrl.search || sessionsUrl.hash || sessionsUrl.origin !== pageOrigin)
    throw new Error('The voice sessions endpoint must be on this application’s origin.');
  return { ...config, url: url.href, sessionsUrl: sessionsUrl.href.replace(/\/$/, ''), audio: config.audio === true };
}

export const vrtAdapter: RealtimePort = {
  open({ config: input, context: inputContext, tools, signal, onStatus, onActivity }) {
    const config = validateRealtimeConfig(input, window.location.origin);
    const context = voiceDocumentContextSchema.parse(inputContext);
    let closed = false, ended = false;
    let session: ClientSession | undefined, voiceSessionId: string | undefined;
    const grantLifetime = new AbortController();
    const off: (() => void)[] = [];
    const publish: typeof onStatus = (...args) => { if (!closed) onStatus(...args); };
    const report = (activity: RealtimeActivity) => { if (!closed) onActivity?.(activity); };
    const requestBody = JSON.stringify({ documentId: context.documentId });
    const request = (url: string, method: 'POST' | 'DELETE', requestSignal: AbortSignal, keepalive = false) => fetch(url, {
      method, credentials: 'same-origin', cache: 'no-store', redirect: 'error', keepalive,
      headers: { 'Content-Type': 'application/json' }, body: requestBody, signal: requestSignal,
    });
    const sessionUrl = () => `${config.sessionsUrl}/${encodeURIComponent(voiceSessionId!)}`;
    const endVoiceSession = () => {
      if (!voiceSessionId || ended) return;
      ended = true;
      // Cleanup must not inherit the already-aborted call/document lifetime.
      void request(sessionUrl(), 'DELETE', AbortSignal.timeout(10000), true).catch(() => {});
    };
    const close = () => {
      if (closed) return;
      closed = true; grantLifetime.abort();
      signal.removeEventListener('abort', close); off.forEach(unsubscribe => unsubscribe());
      session?.interrupt();
      void session?.close().catch(() => {});
      endVoiceSession();
    };
    const start = async () => {
      if (closed) return;
      try {
        // Keep this bounded request alive after close so a late creation can
        // be deleted. Aborting it would lose the newly allocated session ID.
        const response = await request(config.sessionsUrl, 'POST', AbortSignal.timeout(15000), true);
        if (!response.ok) throw new Error('Could not create the voice session. Sign in and check document access.');
        const raw: unknown = await response.json();
        if (raw && typeof raw === 'object' && 'sessionId' in raw && 'documentId' in raw && raw.documentId === context.documentId) {
          const id = voiceResourceIdSchema.safeParse(raw.sessionId);
          if (id.success) voiceSessionId = id.data;
        }
        if (closed) { endVoiceSession(); return; }
        const created = createdVoiceSessionSchema.parse(raw);
        if (created.documentId !== context.documentId || created.realtimePath !== voiceRealtimePath(context.documentId, created.sessionId))
          throw new Error('The voice session returned a mismatched connection path.');
        let initialGrant: typeof created.grant | undefined = created.grant;
        session = new ClientSession(new URL(created.realtimePath, config.url).href, {
          tools, context,
          audio: config.audio ? { input: 'mic', output: 'speaker' } : false,
          auth: async () => {
            if (closed || signal.aborted) throw new Error('Document session closed.');
            const first = initialGrant; initialGrant = undefined;
            if (first && first.expiresAt > Date.now() + 1000) return first.token;
            const response = await request(`${sessionUrl()}/grants`, 'POST', AbortSignal.any([grantLifetime.signal, AbortSignal.timeout(15000)]));
            if (!response.ok) throw new Error('Could not renew the voice session grant.');
            const grant = voiceGrantSchema.parse(await response.json());
            if (closed || signal.aborted) throw new Error('Document session closed.');
            if (grant.expiresAt <= Date.now()) throw new Error('The voice session grant has expired.');
            return grant.token;
          },
        });
        off.push(
          session.on('ready', () => publish('connected')),
          session.on('reconnecting', () => publish('reconnecting')),
          session.on('error', () => publish('error', 'The assistant connection failed. Editing remains available.')),
          session.on('closed', () => { publish('disconnected'); close(); }),
          session.on('state', event => report({ type: 'turn', state: event.state, turnId: event.turnId })),
          session.on('tool.call', event => report({ type: 'call', callId: event.callId, name: event.name, arguments: event.arguments })),
          session.on('tool.result', event => report({ type: 'result', callId: event.callId, ok: event.result.ok })),
          session.on('interrupted', () => report({ type: 'interrupted' })),
        );
        await session.start();
      } catch {
        publish('error', 'Could not connect the assistant. Sign in and check document access and voice configuration.');
        close();
      }
    };
    signal.addEventListener('abort', close, { once: true });
    if (signal.aborted) close();
    else { publish('connecting'); void start(); }
    return {
      close,
      interrupt: reason => { if (!closed) session?.interrupt(reason); },
      sendText: text => { if (!closed && session?.connected) session.sendText(text); },
    };
  },
};
