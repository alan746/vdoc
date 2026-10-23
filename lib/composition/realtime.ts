import { vrtAdapter, validateRealtimeConfig } from '../infrastructure/realtime/vrt-adapter';
import { createRealtimeExecutor } from '../usecases/realtime-executor';
import { realtimeDocumentTools } from '../usecases/document-tools';
import type { DocumentEngine } from '../usecases/engine';
import type { RealtimeActivity, RealtimeConfig, RealtimePort, RealtimeStatus } from '../usecases/ports';

export const REALTIME_CONFIG_KEY = 'vdoc.realtime.v1';
/** Explicit local configuration only; document URLs and imported content cannot enable it. */
export function readRealtimeConfig(): RealtimeConfig | null {
  const raw = window.localStorage.getItem(REALTIME_CONFIG_KEY);
  if (!raw) return null;
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || !('url' in value) || typeof value.url !== 'string' || !('tokenUrl' in value) || typeof value.tokenUrl !== 'string')
    throw new Error('Invalid assistant configuration.');
  return validateRealtimeConfig({ url: value.url, tokenUrl: value.tokenUrl, audio: 'audio' in value && value.audio === true }, window.location.origin);
}

export function openDocumentRealtime(options: {
  engine: DocumentEngine; docId: string; config: RealtimeConfig;
  onStatus: (status: RealtimeStatus, message?: string) => void;
  onActivity?: (activity: RealtimeActivity) => void;
}, port: RealtimePort = vrtAdapter) {
  const { engine, docId, config, onStatus, onActivity } = options;
  const lifecycle = new AbortController();
  const executor = createRealtimeExecutor(engine, {
    docId, actor: 'realtime-assistant', signal: lifecycle.signal,
    currentDocument: () => lifecycle.signal.aborted ? null : { docId, sessionId: engine.sessionId },
  });
  // Server turn counters can restart on a fresh connection to the same editor.
  // Keep IDs stable across SDK resume, but unique across explicit connections.
  // Deliberately unbounded for the connection's life: evicting an entry would
  // give a replayed tool.call a new local callId, miss the executor's dedup and
  // apply the write twice. Each entry is two short strings (~1 MB per 10k calls).
  const callIds = new Map<string, string>(), turnIds = new Map<string, string>();
  const localId = (map: Map<string, string>, remoteId: string) => {
    if (!remoteId) return '';
    let id = map.get(remoteId);
    if (!id) { id = crypto.randomUUID(); map.set(remoteId, id); }
    return id;
  };
  const tools = Object.fromEntries(Object.entries(realtimeDocumentTools(executor)).map(([name, tool]) => [name, {
    ...tool, run: (input: unknown, context: import('../usecases/ports').RealtimeToolContext) => tool.run(input, {
      ...context, callId: localId(callIds, context.callId), turnId: localId(turnIds, context.turnId),
    }),
  }]));
  const connection = port.open({ config, docId, sessionId: engine.sessionId,
    tools, signal: lifecycle.signal, onStatus, onActivity });
  return { ...connection, close() { lifecycle.abort(); connection.close(); } };
}
