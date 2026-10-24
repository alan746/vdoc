import { vrtAdapter, validateRealtimeConfig } from '../infrastructure/realtime/vrt-adapter';
import { createRealtimeExecutor } from '../usecases/realtime-executor';
import { realtimeDocumentTools } from '../usecases/document-tools';
import type { DocumentEngine } from '../usecases/engine';
import type { RealtimeActivity, RealtimeConfig, RealtimePort, RealtimeStatus } from '../usecases/ports';
import { UNTITLED_DOCUMENT } from '../domain/entities/document';
import { canonicalLanguage } from '../domain/text/language';
import { voiceRequestError } from '../infrastructure/realtime/voice-errors';
export { VoiceConnectionError } from '../infrastructure/realtime/voice-errors';

/** Discover trusted deployment configuration without opening a session or microphone. */
export async function loadRealtimeConfig(docId: string, signal: AbortSignal, workspace: 'cloud' | 'local' = 'cloud'): Promise<RealtimeConfig> {
  const response = await fetch(`/api/voice-sessions?documentId=${encodeURIComponent(docId)}${workspace === 'local' ? '&workspace=local' : ''}`, {
    credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
  });
  if (!response.ok) throw await voiceRequestError(response);
  return validateRealtimeConfig(await response.json(), window.location.origin);
}

export function openDocumentRealtime(options: {
  engine: DocumentEngine; docId: string; config: RealtimeConfig;
  title?: string;
  onStatus: (status: RealtimeStatus, message?: string) => void;
  onActivity?: (activity: RealtimeActivity) => void;
  onMicrophone?: Parameters<RealtimePort['open']>[0]['onMicrophone'];
  onInputLevel?: Parameters<RealtimePort['open']>[0]['onInputLevel'];
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
  const language = canonicalLanguage(config.language ?? engine.editor.state.doc.attrs.language);
  const connection = port.open({ config, context: {
    documentId: docId, title: (options.title || UNTITLED_DOCUMENT).slice(0, 120),
    language: language && language !== 'und' ? new Intl.Locale(language).baseName : 'en-US', vocabulary: config.vocabulary ?? [],
  },
    tools, signal: lifecycle.signal, onStatus, onActivity, onMicrophone: options.onMicrophone, onInputLevel: options.onInputLevel });
  return { ...connection, close() { lifecycle.abort(); connection.close(); } };
}
