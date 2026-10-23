'use client';
import { useEffect, useRef, useState } from 'react';
import { openDocumentRealtime, readRealtimeConfig } from '@/lib/composition/realtime';
import type { DocumentEngine } from '@/lib/usecases/engine';
import type { RealtimeConnection, RealtimeConfig, RealtimeStatus } from '@/lib/usecases/ports';
import { documentNavigation } from '@/lib/usecases/document-navigation';
import { isCompositionKey } from '@/lib/editor/keyboard-composition';

/** Minimal controls; timeline and progressive previews are separate work. */
export function RealtimeControls({ engine, docId }: { engine: DocumentEngine; docId: string }) {
  const [config] = useState<RealtimeConfig | null>(() => { try { return readRealtimeConfig(); } catch { return null; } });
  const [status, setStatus] = useState<RealtimeStatus>('disconnected');
  const [message, setMessage] = useState('');
  const [text, setText] = useState('');
  const connection = useRef<RealtimeConnection | null>(null);
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
      connection.current = openDocumentRealtime({ engine, docId, config, onStatus: (next, detail) => { setStatus(next); setMessage(detail ?? ''); } });
    } catch { setStatus('error'); setMessage('Could not connect the assistant.'); }
  };
  return <section aria-label="Document assistant" className="realtime-controls">
    <span role="status">{message || (status === 'connected' ? (config.audio ? 'Assistant connected · Microphone on' : 'Assistant connected') : `Assistant ${status}`)}</span>
    {(status === 'disconnected' || status === 'error') && <button type="button" className="quiet-button" onClick={connect}>{config.audio ? 'Connect voice assistant' : 'Connect assistant'}</button>}
    {status !== 'disconnected' && <>
      <button type="button" className="quiet-button" onClick={() => connection.current?.interrupt()}>Stop assistant</button>
      <button type="button" className="quiet-button" onClick={() => { connection.current?.close(); connection.current = null; setStatus('disconnected'); setMessage(''); }}>Disconnect assistant</button>
    </>}
    <form onSubmit={event => { event.preventDefault(); if (text.trim() && status === 'connected') { connection.current?.sendText(text.trim()); setText(''); } }}>
      <input aria-label="Assistant instruction" value={text} onChange={event => setText(event.target.value)} disabled={status !== 'connected'} placeholder="Ask to edit this document" />
      <button type="submit" className="quiet-button" disabled={status !== 'connected' || !text.trim()}>Send</button>
    </form>
  </section>;
}
