import type { ClientSocket } from '@vrealtime/client';
import { Hub, type Connection } from '@vrealtime/server';
import { fakeAgentModel } from './fake-agent';

/** Where one case's voice session runs. */
export interface EvalSession {
  readonly url: string;
  /** The server's voice session ID, to find the case in its logs. */
  readonly id?: string;
  auth(): Promise<string>;
  readonly WebSocket?: new (url: string) => ClientSocket;
  end(): Promise<void>;
}
export interface EvalTarget {
  readonly name: string;
  open(documentId: string): Promise<EvalSession>;
  close(): Promise<void>;
}

/** A browser-shaped socket whose other end is a Hub connection in this process. */
function memorySocket(hub: Hub): new (url: string) => ClientSocket {
  return class MemorySocket extends EventTarget implements ClientSocket {
    readyState = 0;
    binaryType = 'arraybuffer';
    readonly #connection: Connection;
    constructor(readonly url: string) {
      super();
      this.#connection = hub.attach({
        send: data => {
          const copy = typeof data === 'string' ? data : data.slice().buffer;
          queueMicrotask(() => { if (this.readyState === 1) this.dispatchEvent(new MessageEvent('message', { data: copy })); });
        },
        close: (code, reason) => this.#closed(code ?? 1000, reason ?? ''),
      });
      queueMicrotask(() => { this.readyState = 1; this.dispatchEvent(new Event('open')); });
    }
    send(data: string | Uint8Array) {
      if (this.readyState !== 1) return;
      this.#connection.receive(typeof data === 'string' ? data : data.slice().buffer);
    }
    close(code = 1000, reason = '') {
      if (this.readyState === 3) return;
      this.#connection.closed();
      this.#closed(code, reason);
    }
    #closed(code: number, reason: string) {
      if (this.readyState === 3) return;
      this.readyState = 3;
      queueMicrotask(() => this.dispatchEvent(new CloseEvent('close', { code, reason })));
    }
  };
}

/** The scripted model behind a real vRealTime Hub, in memory. No network, no keys, no cost. */
export function fakeTarget(): EvalTarget {
  const { model, stop } = fakeAgentModel();
  const hub = new Hub({ model, instructions: '', clientTools: 'accept', turnDetection: 'server' }, { authenticate: () => ({ id: 'voice-eval' }) });
  const WebSocket = memorySocket(hub);
  return {
    name: 'fake',
    open: async documentId => ({
      url: `memory://voice/${documentId}`, auth: async () => 'fake-grant', WebSocket, end: async () => {},
    }),
    close: async () => { await hub.close(); stop(); },
  };
}

/**
 * A deployed vdoc-server, called as the trusted application (the role the vdoc
 * BFF plays). Use a preview deployment; every case starts a real, billed session.
 */
export function remoteTarget(options: { serverUrl: string; clientKey: string; userId: string }): EvalTarget {
  const origin = new URL(options.serverUrl).origin;
  const headers = { Authorization: `Bearer ${options.clientKey}`, 'X-Vdoc-User-Id': options.userId, 'Content-Type': 'application/json' };
  const call = async (path: string, method: 'POST' | 'DELETE') => {
    const response = await fetch(`${origin}${path}`, { method, headers: { ...headers, 'X-Request-Id': crypto.randomUUID() }, ...(method === 'POST' ? { body: '{}' } : {}) });
    if (!response.ok) throw new Error(`vdoc-server ${method} ${path} answered ${response.status}: ${(await response.text()).slice(0, 300)}`);
    return method === 'DELETE' ? undefined : await response.json() as Record<string, unknown>;
  };
  return {
    name: new URL(origin).hostname,
    async open(documentId) {
      const base = `/v1/documents/${encodeURIComponent(documentId)}/voice-sessions`;
      const created = await call(base, 'POST') as { sessionId: string; realtimePath: string; grant: { token: string } };
      let first: string | undefined = created.grant.token;
      const session = `${base}/${encodeURIComponent(created.sessionId)}`;
      return {
        url: `${origin.replace(/^http/, 'ws')}${created.realtimePath}`, id: created.sessionId,
        async auth() {
          const token = first; first = undefined;
          return token ?? ((await call(`${session}/grants`, 'POST')) as { token: string }).token;
        },
        end: async () => { await call(session, 'DELETE').catch(() => undefined); },
      };
    },
    close: async () => {},
  };
}
