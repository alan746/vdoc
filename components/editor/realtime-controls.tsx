'use client';
/* Workspace links intentionally reload account-scoped repositories. */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Mic, Square, X, Ellipsis } from 'lucide-react';
import { openDocumentRealtime, loadRealtimeConfig, VoiceConnectionError } from '@/lib/composition/realtime';
import { isCloudWorkspace } from '@/lib/composition/repositories';
import type { DocumentEngine } from '@/lib/usecases/engine';
import type { MicrophoneStatus, RealtimeActivity, RealtimeConnection, RealtimeConfig, RealtimeStatus, RealtimeTurnState } from '@/lib/usecases/ports';
import { documentNavigation } from '@/lib/usecases/document-navigation';
import { isCompositionKey } from '@/lib/editor/keyboard-composition';
import { toolFailureFeedback } from './realtime/tool-failure-feedback';
import { ActivityTimeline } from './realtime/activity-timeline';
import { INTERRUPTED_LAMP_MS, voiceLamp, voiceLampLabels, voiceLampOrder } from './realtime/voice-lamp';

const turnLabels: Record<RealtimeTurnState, string> = { idle: '', listening: 'Listening', thinking: 'Thinking', speaking: 'Speaking', acting: 'Editing' };

/** Persistent voice dock. Speech edits use the existing authenticated tool path. */
export function RealtimeControls({ engine, docId, title }: { engine: DocumentEngine; docId: string; title?: string }) {
  const [cloud] = useState(isCloudWorkspace);
  const [config, setConfig] = useState<RealtimeConfig | null>(null);
  const [checking, setChecking] = useState(true);
  const [accessError, setAccessError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [microphone, setMicrophone] = useState<MicrophoneStatus>('off');
  const [level, setLevel] = useState(0);
  const generation = useRef<symbol | null>(null);
  const starting = useRef(false);
  useEffect(() => {
    const abort = new AbortController();
    loadRealtimeConfig(docId, abort.signal, cloud ? 'cloud' : 'local').then(value => {
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
  const [failures, setFailures] = useState<{ callId: string; feedback: string }[]>([]);
  const [language, setLanguage] = useState('auto');
  const [turn, setTurn] = useState<RealtimeTurnState>('idle');
  const [interrupted, setInterrupted] = useState(false);
  const interruptedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const showInterrupted = () => {
    clearTimeout(interruptedTimer.current); setInterrupted(true);
    interruptedTimer.current = setTimeout(() => setInterrupted(false), INTERRUPTED_LAMP_MS);
  };
  useEffect(() => () => clearTimeout(interruptedTimer.current), []);
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
    setStatus('disconnected'); setMessage(''); setTurn('idle'); setInterrupted(false); setMicrophone('off'); setLevel(0); setHeard(''); setToolFeedback('');
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
          if (next === 'error' || next === 'disconnected') { starting.current = false; setMicrophone('off'); setLevel(0); }
        },
        onInputLevel: value => { if (current === generation.current) setLevel(value); },
        onMicrophone: state => { if (current === generation.current) setMicrophone(state); },
        onActivity: activity => {
          if (current !== generation.current) return;
          if (activity.type === 'turn') { setTurn(activity.state); if (activity.state !== 'idle') setInterrupted(false); }
          else if (activity.type === 'interrupted') { setTurn('idle'); showInterrupted(); setToolFeedback('Stopped. You can keep speaking.'); setToolFailed(false); }
          else if (activity.type === 'transcript' && activity.role === 'user') setHeard(activity.text.slice(-300));
          else if (activity.type === 'call') { setToolFeedback('Working on your request…'); setToolFailed(false); }
          else if (activity.type === 'result') {
            setToolFailed(!activity.ok);
            if (!activity.ok) setFailures(previous => [{ callId: activity.callId, feedback: toolFailureFeedback(activity) }, ...previous.filter(item => item.callId !== activity.callId)].slice(0, 5));
            setToolFeedback(activity.ok ? (activity.name === 'apply_document_operations' ? 'Document updated' : activity.name === 'undo_turn' ? 'Assistant edit undone' : 'Document checked') : toolFailureFeedback(activity));
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
  const placeholder = checking ? 'Checking voice availability…'
    : microphone === 'requesting' ? 'Allow microphone access to start…'
    : status === 'connecting' ? 'Connecting…'
    : status === 'reconnecting' ? 'Reconnecting…'
    : status === 'connected' ? (turn === 'thinking' || turn === 'acting' || turn === 'speaking' ? `${turnLabels[turn]}…` : 'Listening… speak naturally')
    : 'Tap the microphone and start talking';
  const lamp = voiceLamp({ checking, status, microphone, turn, failed: Boolean(accessError || message) || toolFailed, interrupted });
  const busy = status === 'connected' && (turn === 'thinking' || turn === 'acting' || turn === 'speaking');
  return <section aria-label="Document assistant" className="voice-dock" data-active={active} data-lamp={lamp} data-listening={microphone === 'on'} style={{ '--voice-level': level } as CSSProperties}>
    <div className="voice-float">
      <div className="voice-row">
        <div className="voice-field">
          <span className="voice-glow" aria-hidden="true" />
          <div className="voice-field-inner">
            <span className="voice-lamp" aria-hidden="true" title={voiceLampLabels[lamp]} />
            <span role="status" className="sr-only">{statusLabel}</span>
            <span className="sr-only" aria-live="polite">{voiceLampLabels[lamp]}</span>
            <span className="sr-only" aria-live="polite">{microphoneLabels[microphone]}</span>
            <div className="voice-transcript"><p className={`voice-hint ${heard ? '' : 'voice-placeholder'}`}>{heard || placeholder}</p></div>
            {busy && <button type="button" className="voice-stop" onClick={() => connection.current?.interrupt()} title="Stop the current response (Esc). The microphone stays on."><Square size={11} fill="currentColor" /><span className="sr-only">Stop assistant</span></button>}
            <details className="voice-more"><summary aria-label="Voice options"><Ellipsis size={17} /></summary>
              <div className="voice-menu">
                <div className="voice-lamp-legend"><strong>Status lights</strong><ul>{voiceLampOrder.map(item => <li key={item} data-lamp={item} data-current={item === lamp}><span className="voice-lamp" aria-hidden="true" />{voiceLampLabels[item]}</li>)}</ul></div>
                <label className="voice-language">Speech language<select aria-label="Voice language" value={language} onChange={event => setLanguage(event.target.value)} disabled={checking || active}><option value="auto">Document language</option><option value="zh-CN">中文</option><option value="en-US">English</option></select></label>
                {failures.length > 0 && <div className="voice-edits" aria-label="Recent voice failures"><strong>Recent unsuccessful actions</strong><ul>{failures.map(item => <li key={item.callId}>{item.feedback}</li>)}</ul></div>}
                {config && <div className="voice-edits"><strong>Recent edits</strong><ActivityTimeline engine={engine} active={active} subscribeActivity={subscribeActivity} /></div>}
                {!cloud && <p>Local document · Edits stay in this browser. Voice sends audio and document context to the AI service. <a href="/account">Sign in</a> to use voice.</p>}
                <p className="voice-about">Tap once, then speak naturally across multiple turns. Esc interrupts the assistant; tap the microphone again to turn it off. Voice requires a signed-in account and internet access. Cloud documents must be yours and outside Trash. Usage limits apply.</p>
              </div>
            </details>
            <span className="voice-lamp" aria-hidden="true" title={voiceLampLabels[lamp]} />
          </div>
        </div>
        <button type="button" className="voice-orb" disabled={!active && (!config || checking)} onClick={active ? disconnect : connect} title={active ? 'Turn off voice' : 'Start voice input'}>
          {active ? <Square size={15} fill="currentColor" /> : <Mic size={20} />}
          <span className="sr-only">{active ? (status === 'connecting' ? 'Cancel connection' : 'Disconnect assistant') : status === 'error' ? 'Retry voice connection' : 'Connect voice assistant'}</span>
        </button>
      </div>
      {!cloud && !active && <p className="voice-tool-feedback">Saved on this device. Using voice sends audio and document context to AI. <a href="/account">Account / sign in</a></p>}
      {(accessError || message) ? <div role="alert" className="voice-error"><X size={14} /><span>{accessError || message}</span>{accessError && <button type="button" disabled={checking} onClick={() => { setConfig(null); setChecking(true); setAccessError(''); setAttempt(value => value + 1); }}>Retry availability check</button>}</div>
        : toolFeedback && <span className={toolFailed ? 'voice-tool-error' : 'voice-tool-feedback'} role={toolFailed ? 'alert' : 'status'}>{toolFeedback}</span>}
    </div>
  </section>;
}
