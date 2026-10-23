'use client';
/* Workspace links intentionally reload account-scoped repositories. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Square, X, ChevronDown, AudioLines } from 'lucide-react';
import { openDocumentRealtime, loadRealtimeConfig, VoiceConnectionError } from '@/lib/composition/realtime';
import { isCloudWorkspace } from '@/lib/composition/repositories';
import type { DocumentEngine } from '@/lib/usecases/engine';
import type { MicrophoneStatus, RealtimeActivity, RealtimeConnection, RealtimeConfig, RealtimeStatus, RealtimeTurnState } from '@/lib/usecases/ports';
import { documentNavigation } from '@/lib/usecases/document-navigation';
import { isCompositionKey } from '@/lib/editor/keyboard-composition';
import { ActivityTimeline } from './realtime/activity-timeline';

const turnLabels: Record<RealtimeTurnState, string> = { idle: '', listening: 'Listening', thinking: 'Thinking', speaking: 'Speaking', acting: 'Editing' };

/** Persistent voice dock. Speech edits use the existing authenticated tool path. */
export function RealtimeControls({ engine, docId, title }: { engine: DocumentEngine; docId: string; title?: string }) {
  const [cloud] = useState(isCloudWorkspace);
  const [config, setConfig] = useState<RealtimeConfig | null>(null);
  const [checking, setChecking] = useState(cloud);
  const [accessError, setAccessError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [microphone, setMicrophone] = useState<MicrophoneStatus>('off');
  const [levels, setLevels] = useState<number[]>(() => Array(24).fill(0));
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
  const [heard, setHeard] = useState('');
  const [toolFeedback, setToolFeedback] = useState('');
  const [toolFailed, setToolFailed] = useState(false);
  const [language, setLanguage] = useState('auto');
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
    setStatus('disconnected'); setMessage(''); setTurn('idle'); setMicrophone('off'); setLevels(Array(24).fill(0)); setHeard(''); setToolFeedback('');
  };
  const connect = () => {
    if (!config || starting.current) return;
    const current = Symbol(); generation.current = current;
    connection.current?.close(); starting.current = true;
    setStatus('connecting'); setMessage(''); setTurn('idle'); setHeard(''); setToolFeedback(''); setToolFailed(false);
    try {
      connection.current = openDocumentRealtime({ engine, docId, title, config: language === 'auto' ? config : { ...config, language },
        onStatus: (next, detail) => {
          if (current !== generation.current) return;
          setStatus(next); setMessage(detail ?? '');
          if (next !== 'connected') { setTurn('idle'); setToolFeedback(''); }
          if (next === 'error' || next === 'disconnected') { starting.current = false; setMicrophone('off'); setLevels(Array(24).fill(0)); }
        },
        onInputLevel: level => { if (current === generation.current) setLevels(previous => [...previous.slice(1), level]); },
        onMicrophone: state => { if (current === generation.current) setMicrophone(state); },
        onActivity: activity => {
          if (current !== generation.current) return;
          if (activity.type === 'turn') setTurn(activity.state);
          else if (activity.type === 'interrupted') { setTurn('idle'); setToolFeedback('Stopped. You can keep speaking.'); setToolFailed(false); }
          else if (activity.type === 'transcript' && activity.role === 'user') setHeard(activity.text.slice(-300));
          else if (activity.type === 'call') { setToolFeedback('Working on your request…'); setToolFailed(false); }
          else if (activity.type === 'result') {
            setToolFailed(!activity.ok);
            setToolFeedback(activity.ok ? (activity.name === 'apply_document_operations' ? 'Document updated' : activity.name === 'undo_turn' ? 'Assistant edit undone' : 'Document checked') : `Couldn’t complete that action.${activity.code ? ` (${activity.code})` : ''} Please try again.`);
          }
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
  const statusLabel = checking ? 'Checking voice availability…' : status === 'connected' ? ['Assistant connected', turnLabels[turn]].filter(Boolean).join(' · ') : status === 'reconnecting' ? 'Assistant reconnecting…' : status === 'connecting' ? 'Assistant connecting…' : status === 'error' ? 'Assistant connection failed' : 'Assistant disconnected';
  const wave = microphone === 'on' ? 'listening' : 'off';
  const hint = !cloud ? 'Voice editing is available in your cloud workspace.' : active ? heard || 'Speak naturally. Try “Add a three-row table.”' : 'Say it. See it on the page.';
  return <section aria-label="Document assistant" className="voice-dock" data-active={active}>
    <div className="voice-bar">
      <div className={`voice-symbol ${microphone === 'on' ? 'voice-symbol-on' : ''}`} aria-hidden="true">{microphone === 'on' ? <AudioLines size={23} /> : <Mic size={23} />}</div>
      <div className="voice-copy"><div className="voice-title"><strong>Talk to your document</strong><span className={`voice-state voice-state-${status}`} role="status">{statusLabel}</span></div><div className="voice-caption"><div className="voice-wave" data-state={wave} aria-hidden="true">{levels.map((level, index) => <span key={index} style={{ height: `${3 + level * 21}px` }} />)}</div><p className="voice-hint" title={hint}>{hint}</p></div></div>
      <div className="voice-actions">
        {!active && <label className="voice-language"><span className="sr-only">Voice language</span><select aria-label="Voice language" value={language} onChange={event => setLanguage(event.target.value)} disabled={checking}><option value="auto">Document language</option><option value="zh-CN">中文</option><option value="en-US">English</option></select></label>}
        {!active && <button type="button" className="voice-connect" disabled={!config || checking} onClick={connect}><Mic size={16} />{status === 'error' ? 'Retry voice connection' : 'Connect voice assistant'}</button>}
        {active && <>
          <button type="button" className="voice-stop" disabled={status !== 'connected'} onClick={() => connection.current?.interrupt()} title="Stop the current response (Esc). The microphone stays connected."><Square size={14} />Stop assistant</button>
          <button type="button" className="voice-disconnect" onClick={disconnect}><MicOff size={16} /><span>{status === 'connecting' ? 'Cancel connection' : 'Disconnect assistant'}</span></button>
        </>}
      </div>
    </div>
    <div className="voice-underbar">
      <span className="voice-microphone" aria-live="polite"><span className={microphone === 'on' ? 'voice-live-dot' : ''} />{microphoneLabels[microphone]}</span>
      {toolFeedback && <span className={toolFailed ? 'voice-tool-error' : 'voice-tool-feedback'} role={toolFailed ? 'alert' : 'status'}>{toolFeedback}</span>}
      {!cloud && <span>This is a local document. <a href="/account">Open your account</a> to use cloud voice editing.</span>}
      {config && <details className="voice-edits"><summary>Recent edits <ChevronDown size={12} /></summary><div className="voice-details-body"><ActivityTimeline engine={engine} active={active} subscribeActivity={subscribeActivity} /></div></details>}
      <details className="voice-details"><summary>About voice <ChevronDown size={12} /></summary><div className="voice-details-body">Connect once, then speak naturally across multiple turns. Stop interrupts the assistant’s current action; Disconnect turns off the microphone. Voice requires a signed-in account and a cloud document you own outside Trash. Usage limits apply; remaining allowance is not yet shown. Local documents are not uploaded automatically.</div></details>
    </div>
    {(accessError || message) && <div role="alert" className="voice-error"><X size={15} /><span>{accessError || message}</span>{accessError && <button type="button" disabled={checking} onClick={() => { setConfig(null); setChecking(true); setAccessError(''); setAttempt(value => value + 1); }}>Retry availability check</button>}</div>}
  </section>;
}
