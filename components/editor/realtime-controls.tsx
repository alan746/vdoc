'use client';
/* Workspace links intentionally reload account-scoped repositories. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { openDocumentRealtime, loadRealtimeConfig, VoiceConnectionError } from '@/lib/composition/realtime';
import { isCloudWorkspace } from '@/lib/composition/repositories';
import type { DocumentEngine } from '@/lib/usecases/engine';
import type { MicrophoneStatus, RealtimeActivity, RealtimeConnection, RealtimeConfig, RealtimeStatus, RealtimeTurnState } from '@/lib/usecases/ports';
import { documentNavigation } from '@/lib/usecases/document-navigation';
import { isCompositionKey } from '@/lib/editor/keyboard-composition';
import { ActivityTimeline } from './realtime/activity-timeline';

const turnLabels: Record<RealtimeTurnState, string> = { idle: '', listening: 'Listening', thinking: 'Thinking', speaking: 'Speaking', acting: 'Editing' };

/** Connection controls with turn state, Stop/Esc, and the vdoc#33 turn-grouped
 *  activity timeline. Streamed argument previews are separate work: the SDK
 *  emits tool.preview, but its payload is not specified yet (vRT#22). */
export function RealtimeControls({ engine, docId, title }: { engine: DocumentEngine; docId: string; title?: string }) {
  const [cloud] = useState(isCloudWorkspace);
  const [config, setConfig] = useState<RealtimeConfig | null>(null);
  const [checking, setChecking] = useState(cloud);
  const [accessError, setAccessError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [microphone, setMicrophone] = useState<MicrophoneStatus>('off');
  const generation = useRef<symbol | null>(null);
  const starting = useRef(false);
  useEffect(() => {
    if (!cloud) return;
    const abort = new AbortController();
    loadRealtimeConfig(docId, abort.signal).then(value => {
      if (!abort.signal.aborted) { setConfig(value); setAccessError(''); setChecking(false); }
    }).catch(error => {
      if (!abort.signal.aborted) {
        setAccessError(error instanceof VoiceConnectionError ? error.message : 'Voice availability could not be checked. Check your connection and retry.');
        setChecking(false);
      }
    });
    return () => abort.abort();
  }, [cloud, docId, attempt]);
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
    return () => { window.removeEventListener('keydown', stop); generation.current = null; starting.current = false; connection.current?.close(); connection.current = null; };
  }, [engine, docId]);
  const disconnect = () => {
    generation.current = null; starting.current = false;
    connection.current?.close(); connection.current = null;
    setStatus('disconnected'); setMessage(''); setTurn('idle'); setMicrophone('off');
  };
  const connect = () => {
    if (!config || starting.current) return;
    const current = Symbol(); generation.current = current;
    connection.current?.close(); starting.current = true;
    setStatus('connecting'); setMessage(''); setTurn('idle');
    try {
      connection.current = openDocumentRealtime({ engine, docId, title, config,
        onStatus: (next, detail) => {
          if (current !== generation.current) return;
          setStatus(next); setMessage(detail ?? '');
          if (next !== 'connected') setTurn('idle');
          if (next === 'error' || next === 'disconnected') { starting.current = false; setMicrophone('off'); }
        },
        onMicrophone: state => { if (current === generation.current) setMicrophone(state); },
        onActivity: activity => {
          if (current !== generation.current) return;
          if (activity.type === 'turn') setTurn(activity.state);
          else if (activity.type === 'interrupted') setTurn('idle');
          for (const listener of activityListeners.current) listener(activity);
        } });
    } catch {
      starting.current = false; setStatus('error'); setMicrophone('off');
      setMessage('Could not connect the assistant. Check your connection and retry.');
    }
  };
  const active = status === 'connecting' || status === 'connected' || status === 'reconnecting';
  const microphoneLabels: Record<MicrophoneStatus, string> = {
    off: 'Microphone off', requesting: 'Waiting for microphone permission… Allow access in your browser.',
    ready: 'Microphone allowed · Connecting…', on: 'Microphone on', error: 'Microphone unavailable',
  };
  return <section aria-label="Document assistant" className="realtime-controls">
    <div className="realtime-connection">
      <strong>Voice assistant</strong>
      <span role="status">{checking ? 'Checking voice availability…' : status === 'connected' ? ['Assistant connected', turnLabels[turn]].filter(Boolean).join(' · ') : status === 'reconnecting' ? 'Assistant reconnecting…' : status === 'connecting' ? 'Assistant connecting…' : status === 'error' ? 'Assistant connection failed' : 'Assistant disconnected'}</span>
      <span aria-live="polite">{microphoneLabels[microphone]}</span>
      {!active && <button type="button" className="secondary-button" disabled={!config || checking} onClick={connect}>{status === 'error' ? 'Retry voice connection' : 'Connect voice assistant'}</button>}
      {active && <>
        <button type="button" className="quiet-button" disabled={status !== 'connected'} onClick={() => connection.current?.interrupt()}>Stop assistant</button>
        <button type="button" className="quiet-button" onClick={disconnect}>{status === 'connecting' ? 'Cancel connection' : 'Disconnect assistant'}</button>
      </>}
    </div>
    <p className="realtime-note">Voice requires a signed-in account, an internet connection, and a cloud document you own that is outside Trash. Microphone access starts only when you connect.</p>
    {!cloud && <p className="realtime-note">This is a local document. <a href="/account">Sign in</a>, then <a href="/cloud">open the cloud workspace</a>. To use this document there, export a backup and import it into the cloud workspace; local documents are not uploaded automatically.</p>}
    {cloud && <p className="realtime-note">Voice quota is checked by the service when connecting and during use. Remaining allowance is currently unavailable. <a href="/account">Account</a></p>}
    {(accessError || message) && <p role="alert" className="realtime-error">{accessError || message} {accessError && <button type="button" className="quiet-button" disabled={checking} onClick={() => { setChecking(true); setAccessError(''); setAttempt(value => value + 1); }}>Retry availability check</button>}</p>}
    {config && <>
      <form onSubmit={event => { event.preventDefault(); if (text.trim() && status === 'connected') { connection.current?.sendText(text.trim()); setText(''); } }}>
        <input aria-label="Assistant instruction" value={text} onChange={event => setText(event.target.value)} disabled={status !== 'connected'} placeholder="Ask to edit this document" />
        <button type="submit" className="quiet-button" disabled={status !== 'connected' || !text.trim()}>Send</button>
      </form>
      <ActivityTimeline engine={engine} active={active} subscribeActivity={subscribeActivity} />
    </>}
  </section>;
}
