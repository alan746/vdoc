import { CaptureResampler, ClientSession, createSpeaker } from '@vrealtime/client';
import { z } from 'zod/v3';
import { createdVoiceSessionSchema, voiceDocumentContextSchema, voiceGrantSchema, voiceLanguageSchema, voiceRealtimePath, voiceResourceIdSchema, voiceVocabularySchema } from '../../domain/entities/voice-session';
import type { RealtimeActivity, RealtimeConfig, RealtimePort } from '../../usecases/ports';
import { voiceRequestError, VoiceConnectionError } from './voice-errors';
import { prepareBrowserAudio } from './browser-audio';

const loopback = (host: string) => host === 'localhost' || host === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(host);
const configSchema = z.object({ workspace: z.enum(['cloud', 'local']).optional(), url: z.string(), sessionsUrl: z.string(), audio: z.boolean().optional(), language: voiceLanguageSchema.optional(), vocabulary: voiceVocabularySchema.optional() });
/** Configuration comes from the authenticated application endpoint, never a document or link. */
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
  open({ config: input, context: inputContext, tools, signal, onStatus, onActivity, onMicrophone, onInputLevel }) {
    const config = validateRealtimeConfig(input, window.location.origin);
    const context = voiceDocumentContextSchema.parse(inputContext);
    let closed = false, ended = false;
    let session: ClientSession | undefined, voiceSessionId: string | undefined;
    const grantLifetime = new AbortController();
    const audioLifetime = new AbortController();
    let renewalError: string | undefined;
    const off: (() => void)[] = [];
    const publish: typeof onStatus = (...args) => { if (!closed) onStatus(...args); };
    const report = (activity: RealtimeActivity) => { if (!closed) onActivity?.(activity); };
    const requestBody = JSON.stringify({ documentId: context.documentId, ...(config.workspace === 'local' ? { workspace: 'local' } : {}) });
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
      closed = true; grantLifetime.abort(); audioLifetime.abort();
      onMicrophone?.('off');
      onInputLevel?.(0);
      signal.removeEventListener('abort', close); off.forEach(unsubscribe => unsubscribe());
      session?.interrupt();
      void session?.close().catch(() => {});
      endVoiceSession();
    };
    const fail = (message: string) => { publish('error', message); close(); };
    const start = async () => {
      if (closed) return;
      try {
        const audio = config.audio ? await prepareBrowserAudio({
          signal: audioLifetime.signal, resampler: CaptureResampler.toString(), createSpeaker,
          onInputLevel: level => { if (!closed) onInputLevel?.(level); },
          onMicrophone: state => { if (!closed) onMicrophone?.(state); }, onFailure: fail,
        }) : undefined;
        if (closed) return;
        // Keep this bounded request alive after close so a late creation can
        // be deleted. Aborting it would lose the newly allocated session ID.
        const response = await request(config.sessionsUrl, 'POST', AbortSignal.timeout(15000), true);
        if (!response.ok) throw await voiceRequestError(response);
        const raw: unknown = await response.json();
        if (raw && typeof raw === 'object' && 'sessionId' in raw && 'documentId' in raw && raw.documentId === context.documentId) {
          const id = voiceResourceIdSchema.safeParse(raw.sessionId);
          if (id.success) voiceSessionId = id.data;
        }
        if (closed) { endVoiceSession(); return; }
        const created = createdVoiceSessionSchema.parse(raw);
        if (created.documentId !== context.documentId || created.realtimePath !== voiceRealtimePath(created.transportDocumentId ?? context.documentId, created.sessionId))
          throw new Error('The voice session returned a mismatched connection path.');
        let initialGrant: typeof created.grant | undefined = created.grant;
        session = new ClientSession(new URL(created.realtimePath, config.url).href, {
          tools, context: { ...context, documentId: created.transportDocumentId ?? context.documentId },
          audio: audio ? { input: audio.input, output: audio.output } : false,
          auth: async () => {
            if (closed || signal.aborted) throw new Error('Document session closed.');
            const first = initialGrant; initialGrant = undefined;
            if (first && first.expiresAt > Date.now() + 1000) return first.token;
            const response = await request(`${sessionUrl()}/grants`, 'POST', AbortSignal.any([grantLifetime.signal, AbortSignal.timeout(15000)]));
            if (!response.ok) {
              const error = await voiceRequestError(response); renewalError = error.message; throw error;
            }
            const grant = voiceGrantSchema.parse(await response.json());
            if (closed || signal.aborted) throw new Error('Document session closed.');
            if (grant.expiresAt <= Date.now()) throw new Error('The voice session grant has expired.');
            return grant.token;
          },
        });
        off.push(
          session.on('ready', () => publish('connected')),
          session.on('reconnecting', () => publish('reconnecting')),
          session.on('error', event => {
            // A recoverable provider/turn failure leaves the SDK session usable.
            // Closing here would DELETE the voice session and prevent retrying
            // the next instruction. Auth, audio and quota failures remain fatal.
            if (event.code === 'AGENT_ERROR' && event.recoverable && !renewalError) {
              publish(session?.connected ? 'connected' : 'connecting', 'The assistant could not complete that instruction. Try again.');
              return;
            }
            const quota = ['QUOTA_EXCEEDED', 'QUOTA_EXHAUSTED', 'INSUFFICIENT_QUOTA'].includes(event.code);
            const message = renewalError || (quota ? 'Voice quota is exhausted. Contact the site administrator about your allowance.' : event.code === 'RATE_LIMITED' ? 'Voice request limit reached. Wait before reconnecting.' : event.code === 'AUDIO_FAILED' ? 'Audio could not start. Check your microphone and browser audio settings, then reconnect.' : 'The assistant connection failed. Check your connection and reconnect.');
            fail(message);
          }),
          session.on('closed', () => { publish('disconnected'); close(); }),
          session.on('state', event => report({ type: 'turn', state: event.state, turnId: event.turnId })),
          session.on('transcript', event => report({ type: 'transcript', role: event.role, itemId: event.itemId, text: event.text, final: event.final })),
          session.on('tool.call', event => report({ type: 'call', callId: event.callId, name: event.name, arguments: event.arguments })),
          session.on('tool.result', event => report({ type: 'result', callId: event.callId, name: event.name, ok: event.result.ok,
            ...(!event.result.ok ? { code: event.result.code, message: event.result.message.slice(0, 1000) } : {}) })),
          session.on('interrupted', () => report({ type: 'interrupted' })),
        );
        await session.start();
      } catch (error) {
        fail(error instanceof VoiceConnectionError ? error.message : 'Could not connect the assistant. Check your connection and retry.');
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
