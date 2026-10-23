'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { openDocumentRealtime, readRealtimeConfig } from '@/lib/composition/realtime';
import type { DocumentEngine } from '@/lib/usecases/engine';
import type { RealtimeActivity, RealtimeConnection, RealtimeConfig, RealtimeStatus, RealtimeTurnState } from '@/lib/usecases/ports';
import { documentNavigation } from '@/lib/usecases/document-navigation';
import { isCompositionKey } from '@/lib/editor/keyboard-composition';
import { ActivityTimeline } from './realtime/activity-timeline';

const turnLabels: Record<RealtimeTurnState, string> = { idle: '', listening: 'Listening', thinking: 'Thinking', speaking: 'Speaking', acting: 'Editing' };

/** Connection controls with turn state, Stop/Esc, and the vdoc#33 turn-grouped
 *  activity timeline. Streamed argument previews are separate work: the SDK
 *  emits tool.preview, but its payload is not specified yet (vRT#22). */
export function RealtimeControls({ engine, docId }: { engine: DocumentEngine; docId: string }) {
  const [config] = useState<RealtimeConfig | null>(() => { try { return readRealtimeConfig(); } catch { return null; } });
  const [status, setStatus] = useState<RealtimeStatus>('disconnected');
  const [message, setMessage] = useState('');
  const [text, setText] = useState('');
  const [turn, setTurn] = useState<RealtimeTurnState>('idle');
  const connection = useRef<RealtimeConnection | null>(null);
  const activityListeners = useRef(new Set<(activity: RealtimeActivity) => void>());
  const subscribeActivity = useCallback((listener: (activity: RealtimeActivity) => void) => {
    activityListeners.current.add(listener);
    return () => { activityListeners.current.delete(listener); };
  }, []);
  useEffect(() => {
    const stop = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || isCompositionKey(event) || documentNavigation(engine.editor).isComposing() || document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]')) return;
      if (connection.current) { event.preventDefault(); connection.current.interrupt('keyboard'); }
    };
    window.addEventListener('keydown', stop);
    return () => { window.removeEventListener('keydown', stop); connection.current?.close(); connection.current = null; };
  }, [engine, docId]);
  if (!config) return null;
  const connect = () => {
    connection.current?.close();
    try {
      connection.current = openDocumentRealtime({ engine, docId, config,
        onStatus: (next, detail) => { setStatus(next); setMessage(detail ?? ''); if (next !== 'connected') setTurn('idle'); },
        onActivity: activity => {
          if (activity.type === 'turn') setTurn(activity.state);
          else if (activity.type === 'interrupted') setTurn('idle');
          for (const listener of activityListeners.current) listener(activity);
        } });
    } catch { setStatus('error'); setMessage('Could not connect the assistant.'); }
  };
  return <section aria-label="Document assistant" className="realtime-controls">
    <span role="status">{message || (status === 'connected' ? [config.audio ? 'Assistant connected · Microphone on' : 'Assistant connected', turnLabels[turn]].filter(Boolean).join(' · ') : `Assistant ${status}`)}</span>
    {(status === 'disconnected' || status === 'error') && <button type="button" className="quiet-button" onClick={connect}>{config.audio ? 'Connect voice assistant' : 'Connect assistant'}</button>}
    {status !== 'disconnected' && <>
      <button type="button" className="quiet-button" onClick={() => connection.current?.interrupt()}>Stop assistant</button>
      <button type="button" className="quiet-button" onClick={() => { connection.current?.close(); connection.current = null; setStatus('disconnected'); setMessage(''); setTurn('idle'); }}>Disconnect assistant</button>
    </>}
    <form onSubmit={event => { event.preventDefault(); if (text.trim() && status === 'connected') { connection.current?.sendText(text.trim()); setText(''); } }}>
      <input aria-label="Assistant instruction" value={text} onChange={event => setText(event.target.value)} disabled={status !== 'connected'} placeholder="Ask to edit this document" />
      <button type="submit" className="quiet-button" disabled={status !== 'connected' || !text.trim()}>Send</button>
    </form>
    <ActivityTimeline engine={engine} active={status !== 'disconnected'} subscribeActivity={subscribeActivity} />
  </section>;
}
