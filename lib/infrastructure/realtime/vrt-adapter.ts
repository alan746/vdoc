import { ClientSession } from '@vrealtime/client';
import type { RealtimeConfig, RealtimePort } from '../../usecases/ports';

const loopback = (host: string) => host === 'localhost' || host === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(host);
/** Configuration is supplied locally, never derived from a document or link. */
export function validateRealtimeConfig(config: RealtimeConfig, pageOrigin: string): RealtimeConfig {
  const url = new URL(config.url);
  if (url.username || url.password || url.search || url.hash || !(url.protocol === 'wss:' || (url.protocol === 'ws:' && loopback(url.hostname))))
    throw new Error('Use wss:// or a loopback ws:// server, without credentials or query parameters.');
  const tokenUrl = new URL(config.tokenUrl, pageOrigin);
  if (tokenUrl.username || tokenUrl.password || tokenUrl.search || tokenUrl.hash || tokenUrl.origin !== pageOrigin)
    throw new Error('The token endpoint must be on this application’s origin.');
  return { url: url.href, tokenUrl: tokenUrl.href, audio: config.audio === true };
}

export const vrtAdapter: RealtimePort = {
  open({ config: input, docId, sessionId, tools, signal, onStatus }) {
    const config = validateRealtimeConfig(input, window.location.origin);
    let closed = false;
    const tokenLifetime = new AbortController();
    const publish: typeof onStatus = (...args) => { if (!closed) onStatus(...args); };
    // Keep the handle before handshake completion so unmount cancels even a
    // stalled handshake. This is the same SDK session used by connect().
    const session = new ClientSession(config.url, {
      tools,
      context: { docId, documentSessionId: sessionId },
      audio: config.audio ? { input: 'mic', output: 'speaker' } : false,
      auth: async () => {
        if (closed || signal.aborted) throw new Error('Document session closed.');
        const response = await fetch(config.tokenUrl, {
          method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ docId, sessionId }), signal: tokenLifetime.signal,
        });
        if (!response.ok) throw new Error('Could not authorize the document connection.');
        const data: unknown = await response.json();
        if (closed || signal.aborted) throw new Error('Document session closed.');
        if (!data || typeof data !== 'object' || !('token' in data) || typeof data.token !== 'string' || !data.token.trim())
          throw new Error('The token endpoint returned an invalid token.');
        return data.token;
      },
    });
    const off = [
      session.on('ready', () => publish('connected')),
      session.on('reconnecting', () => publish('reconnecting')),
      session.on('error', () => publish('error', 'The assistant connection failed. Editing remains available.')),
      session.on('closed', () => publish('disconnected')),
    ];
    const close = () => {
      if (closed) return;
      closed = true; tokenLifetime.abort();
      signal.removeEventListener('abort', close); off.forEach(unsubscribe => unsubscribe());
      // Close the epoch before async SDK audio teardown.
      session.interrupt();
      void session.close().catch(() => {});
    };
    signal.addEventListener('abort', close, { once: true });
    if (signal.aborted) close();
    else {
      publish('connecting');
      void session.start().catch(() => { publish('error', 'Could not connect the assistant.'); close(); });
    }
    return {
      close,
      interrupt: reason => { if (!closed) session.interrupt(reason); },
      sendText: text => { if (!closed && session.connected) session.sendText(text); },
    };
  },
};
