import { parse } from 'partial-json';
import type { RealtimeActivity, StreamDraft } from '../../usecases/ports';

type PreviewEvent = { callId: string; name: string } & (
  | { phase: 'start' | 'progress' | 'cancelled' }
  | { phase: 'arguments-delta'; delta: string }
  | { phase: 'arguments-complete'; arguments: unknown }
  | { phase: 'settled'; ok: boolean }
  | { phase: 'failed'; message: string }
);

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
function anchorOf(input: unknown): StreamDraft['anchor'] | undefined {
  const value = record(input);
  if (!value) return;
  if (value.kind === 'document_end') return { kind: 'document_end' };
  if (['before_block', 'after_block'].includes(String(value.kind)) && typeof value.blockId === 'string')
    return { kind: value.kind as 'before_block' | 'after_block', blockId: value.blockId };
  if (value.kind === 'text' && typeof value.blockId === 'string' && Number.isInteger(value.start))
    return { kind: 'text', blockId: value.blockId, offset: value.start as number };
  if (value.kind === 'range' && Number.isInteger(value.from)) return { kind: 'position', pos: value.from as number };
  if (value.kind === 'block' && typeof value.id === 'string') return { kind: 'after_block', blockId: value.id };
}
function placementOf(op: Record<string, unknown>): StreamDraft['anchor'] | undefined {
  const position = record(op.position);
  if (position && op.beforeId === undefined && typeof position.anchorId === 'string' && ['before', 'after'].includes(String(position.relation)))
    return { kind: position.relation === 'before' ? 'before_block' : 'after_block', blockId: position.anchorId };
  if (op.position !== undefined) return;
  if (op.beforeId === null) return { kind: 'document_end' };
  if (typeof op.beforeId === 'string') return { kind: 'before_block', blockId: op.beforeId };
}
const contentOf = (input: unknown, name: string) => {
  const value = record(input);
  const parts: string[] = [], drafts: StreamDraft[] = [];
  let remaining = 16000;
  const add = (text: unknown, anchor?: StreamDraft['anchor'], block?: StreamDraft['block']) => {
    if (typeof text !== 'string' || !text || remaining <= 0) return;
    const bounded = text.slice(0, remaining); remaining -= bounded.length + 2;
    parts.push(bounded);
    if (anchor) drafts.push({ text: bounded, anchor, ...(block ? { block } : {}) });
  };
  const level = (value: unknown) => Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 6 ? value as number : undefined;
  if (value && name === 'insert_structured_article') {
    const anchor = anchorOf(value.destination);
    add(value.title, anchor, { kind: 'heading', level: 1 });
    if (Array.isArray(value.blocks)) for (const item of value.blocks.slice(0, 80)) {
      const block = record(item), headingLevel = level(block?.level);
      // A heading whose level has not streamed yet shows as a paragraph until it arrives.
      add(block?.text, anchor, block?.kind === 'heading' && headingLevel ? { kind: 'heading', level: headingLevel } : { kind: 'paragraph' });
    }
  } else if (value && Array.isArray(value.operations)) {
    for (const operation of value.operations.slice(0, 200)) {
      const op = record(operation);
      if (!op) continue;
      if (['text.insert', 'text.replace'].includes(String(op.type))) add(op.text, anchorOf(value.target));
      else if (op.type === 'text.findReplace') add(op.replacement);
      else if (op.type === 'block.insert') {
        const block = record(op.block), anchor = placementOf(op), headingLevel = level(block?.level);
        if (block?.kind === 'table') {
          const cells = (row: unknown) => Array.isArray(row) ? row.slice(0, 20).map(cell => typeof cell === 'string' ? cell : '') : [];
          const header = block.header !== false && Array.isArray(block.headerText);
          const rows = [...(header ? [cells(block.headerText)] : []), ...(Array.isArray(block.rowsText) ? block.rowsText.slice(0, 30).map(cells) : [])].filter(row => row.length);
          add(rows.map(row => row.join(' ｜ ')).join('\n'), anchor, { kind: 'table', header, rows });
        } else add(block?.text, anchor, block?.kind === 'heading' && headingLevel ? { kind: 'heading', level: headingLevel } : { kind: 'paragraph' });
      }
    }
  }
  // An article written into a blank document takes the place of its empty paragraph.
  return { text: parts.join('\n\n'), ...(drafts.length ? { drafts, ...(name === 'insert_structured_article' ? { replacesBlankDocument: true } : {}) } : {}) };
};

/** Display streamed arguments only; incomplete JSON never enters a document tool. */
export function createStreamPreview(report: (activity: RealtimeActivity) => void) {
  let draft: { callId: string; name: string; raw: string; text: string } | undefined;
  const closed = new Set<string>();
  const retire = (id: string) => { closed.add(id); if (closed.size > 256) closed.delete(closed.values().next().value!); };
  const finish = (callId: string, phase: 'complete' | 'failed' | 'cancelled') => {
    retire(callId);
    if (draft?.callId !== callId) return;
    report({ type: 'preview', callId, text: draft.text, phase }); draft = undefined;
  };
  return {
    receive(event: PreviewEvent) {
      if (!['insert_structured_article', 'apply_document_operations'].includes(event.name) || closed.has(event.callId)) return;
      if (event.phase === 'settled') { finish(event.callId, event.ok ? 'complete' : 'failed'); return; }
      if (event.phase === 'cancelled' || event.phase === 'failed') { finish(event.callId, event.phase); return; }
      if (draft?.callId !== event.callId) {
        if (draft) finish(draft.callId, 'cancelled');
        draft = { callId: event.callId, name: event.name, raw: '', text: '' };
      }
      let input: unknown;
      if (event.phase === 'arguments-delta') {
        if (draft.raw.length + event.delta.length > 512000) { finish(event.callId, 'failed'); return; }
        draft.raw += event.delta;
        try { input = parse(draft.raw); } catch { return; }
      } else if (event.phase === 'start') {
        report({ type: 'preview', callId: draft.callId, text: '', phase: 'streaming' });
        return;
      } else if (event.phase === 'arguments-complete') input = event.arguments;
      else return;
      const content = contentOf(input, draft.name);
      draft.text = content.text;
      report({ type: 'preview', callId: draft.callId, ...content, phase: event.phase === 'arguments-complete' ? 'pending' : 'streaming' });
    },
    finish(callId: string, ok: boolean) { finish(callId, ok ? 'complete' : 'failed'); },
    cancel() { if (draft) finish(draft.callId, 'cancelled'); },
  };
}
