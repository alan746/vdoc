'use client';
import { useEffect, useRef, useState } from 'react';
import type { RealtimeActivity } from '@/lib/usecases/ports';

type Preview = Extract<RealtimeActivity, { type: 'preview' }>;
const labels: Record<Preview['phase'], string> = {
  streaming: '正在生成', pending: '正在写入文档', complete: '已写入文档', failed: '本次内容未写入', cancelled: '已停止生成',
};

/** A transient output view; only the normal document tools commit changes. */
export function VoiceStream({ subscribe }: { subscribe: (listener: (activity: RealtimeActivity) => void) => () => void }) {
  const [spoken, setSpoken] = useState('');
  const [progress, setProgress] = useState({ responseId: '', text: '' });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [stage, setStage] = useState('');
  const pending = useRef(new Set<string>());
  const userItem = useRef('');
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => subscribe(activity => {
    if (activity.type === 'turn') {
      if (activity.state === 'thinking') setStage('已收到，正在处理…');
      else if (activity.state === 'idle' || activity.state === 'listening') setStage('');
    } else if (activity.type === 'transcript') {
      if (activity.role === 'agent') setSpoken(activity.text.slice(-1000));
      else if (activity.itemId !== userItem.current) {
        userItem.current = activity.itemId;
        setSpoken(''); setProgress({ responseId: '', text: '' }); setPreview(null);
      }
    } else if (activity.type === 'text') {
      if (activity.delta.startsWith('[执行阶段]')) { setStage('正在处理你的指令…'); return; }
      setProgress(previous => ({ responseId: activity.responseId,
        text: ((previous.responseId === activity.responseId ? previous.text : '') + activity.delta).slice(-4000) }));
    } else if (activity.type === 'preview') {
      setPreview(activity);
      setStage(labels[activity.phase]);
    } else if (activity.type === 'call') {
      pending.current.add(activity.callId);
      setStage(['get_context', 'read_document', 'read_blocks'].includes(activity.name) ? '正在读取相关内容…' : '正在修改文档…');
    } else if (activity.type === 'result') {
      pending.current.delete(activity.callId);
      setStage(!activity.ok ? '本次操作未完成' : pending.current.size ? '正在处理…'
        : ['get_context', 'read_document', 'read_blocks'].includes(activity.name ?? '') ? '已读取，正在生成下一步操作…' : '修改已完成，正在整理结果…');
    } else if (activity.type === 'interrupted') {
      pending.current.clear(); setStage('已停止');
      setSpoken(''); setProgress({ responseId: '', text: '' });
      setPreview(previous => previous && !['complete', 'failed'].includes(previous.phase) ? { ...previous, phase: 'cancelled' } : previous);
    }
  }), [subscribe]);
  useEffect(() => { if (body.current) body.current.scrollTop = body.current.scrollHeight; }, [preview?.text, progress.text]);
  if (!stage && !spoken && !progress.text && !preview) return null;
  return <section className="voice-stream" aria-label="Assistant live output">
    {stage && <p className="voice-stream-label" aria-live="polite">{stage}</p>}
    {spoken && <p className="voice-stream-status">{spoken}</p>}
    {progress.text && progress.text !== spoken && <p className="voice-stream-status">{progress.text}</p>}
    {preview && <>
      <p className="voice-stream-label">{labels[preview.phase]}</p>
      <div ref={body} className="voice-stream-body" aria-label="Generated content" aria-busy={preview.phase === 'streaming' || preview.phase === 'pending'}>{preview.text || '正在准备内容…'}</div>
    </>}
  </section>;
}
