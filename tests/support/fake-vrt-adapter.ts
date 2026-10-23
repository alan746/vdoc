import type { RealtimeActivity, RealtimePort, RealtimeToolContext } from '../../lib/usecases/ports';

/** One simulated connection: lets a test drive the status lifecycle and invoke
 *  registered tools the way the real @vrealtime/client SDK would once it has
 *  complete arguments. Streaming/preview arguments are not part of the SDK yet
 *  (tracked by vdoc#35 and austinchennn/vRT#22) so this fake only covers the
 *  full-arguments call path those issues already rely on. */
export type FakeRealtimeSession = {
  readonly tools: Record<string, { description: string; parameters: unknown; run(input: unknown, context: RealtimeToolContext): unknown }>;
  readonly closed: boolean;
  call(name: string, input: unknown, context: RealtimeToolContext): unknown;
  reconnect(): void;
  fail(message: string): void;
  disconnectFromServer(): void;
  /** Delivers a provider activity event (turn state, call, result, interrupt). */
  activity(event: RealtimeActivity): void;
};

/** Stand-in for @vrealtime/client, used to exercise lib/composition/realtime.ts
 *  and the document tools against a real DocumentEngine without a network
 *  connection or the provider SDK. Connects synchronously and only reacts to
 *  status changes a caller triggers explicitly through the returned sessions. */
export function createFakeVrtAdapter(): { port: RealtimePort; sessions: FakeRealtimeSession[] } {
  const sessions: FakeRealtimeSession[] = [];
  const port: RealtimePort = {
    open({ tools, signal, onStatus, onActivity }) {
      let closed = false;
      const publish: typeof onStatus = (...args) => { if (!closed) onStatus(...args); };
      const close = () => { closed = true; };
      signal.addEventListener('abort', close, { once: true });
      if (signal.aborted) close();
      else { publish('connecting'); publish('connected'); }
      const session: FakeRealtimeSession = {
        tools,
        get closed() { return closed; },
        call(name, input, context) {
          const tool = tools[name];
          if (!tool) throw new Error(`Unknown fake realtime tool "${name}".`);
          return tool.run(input, context);
        },
        reconnect() { if (!closed) { publish('reconnecting'); publish('connected'); } },
        fail(message) { publish('error', message); },
        disconnectFromServer() { publish('disconnected'); },
        activity(event) { if (!closed) onActivity?.(event); },
      };
      sessions.push(session);
      return { interrupt() {}, sendText() {}, close };
    },
  };
  return { port, sessions };
}
