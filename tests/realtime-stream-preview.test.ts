import { expect, it } from 'vitest';
import { createStreamPreview } from '../lib/infrastructure/realtime/stream-preview';
import type { RealtimeActivity } from '../lib/usecases/ports';

const base = { type: 'tool.stream' as const, callId: 'write', epoch: 1, turnId: 'turn', name: 'insert_structured_article' };
const setup = () => {
  const events: RealtimeActivity[] = [];
  return { events, preview: createStreamPreview(event => events.push(event)) };
};
it('shows partial plain text before complete JSON and marks it committed only after success', () => {
  const { preview, events } = setup();
  preview.receive({ ...base, phase: 'start' });
  expect(events.at(-1)).toMatchObject({ phase: 'streaming', text: '' });
  preview.receive({ ...base, phase: 'arguments-delta', delta: '{"blocks":[{"kind":"paragraph","text":"正在' });
  expect(events.at(-1)).toMatchObject({ phase: 'streaming', text: '正在' });
  preview.receive({ ...base, phase: 'arguments-delta', delta: '生成正文。"}]}' });
  expect(events.at(-1)).toMatchObject({ phase: 'streaming', text: '正在生成正文。' });
  preview.receive({ ...base, phase: 'arguments-complete', arguments: { blocks: [{ kind: 'paragraph', text: '正在生成正文。' }] } });
  expect(events.at(-1)).toMatchObject({ phase: 'pending' });
  preview.finish('write', true);
  expect(events.at(-1)).toMatchObject({ phase: 'complete' });
});
it('handles split escapes without exposing raw JSON or losing the last preview', () => {
  const { preview, events } = setup();
  preview.receive({ ...base, phase: 'arguments-delta', delta: '{"blocks":[{"text":"正文' });
  preview.receive({ ...base, phase: 'arguments-delta', delta: '\\u4' });
  preview.receive({ ...base, phase: 'arguments-delta', delta: 'e2d"}]}' });
  expect(events.at(-1)).toMatchObject({ text: '正文中' });
});
it.each(['cancelled', 'failed'] as const)('keeps %s terminal despite late chunks and a late success', phase => {
  const { preview, events } = setup();
  preview.receive({ ...base, phase: 'arguments-delta', delta: '{"title":"草稿' });
  if (phase === 'failed') preview.receive({ ...base, phase, message: 'Generation failed' });
  else preview.receive({ ...base, phase });
  const count = events.length;
  preview.receive({ ...base, phase: 'arguments-delta', delta: '不应显示' });
  preview.receive({ ...base, phase: 'settled', ok: true });
  expect(events).toHaveLength(count);
  expect(events.at(-1)).toMatchObject({ phase, text: '草稿' });
});
it('bounds oversized drafts and only previews text edit fields', () => {
  const { preview, events } = setup();
  preview.receive({ ...base, phase: 'arguments-delta', delta: 'x'.repeat(512001) });
  expect(events.at(-1)).toMatchObject({ phase: 'failed' });
  preview.receive({ ...base, callId: 'other', name: 'apply_document_operations', phase: 'arguments-complete', arguments: {
    expectedSessionId: 'private-session', operations: [{ type: 'text.replace', text: '<script>plain text</script>' }, { type: 'block.delete', id: 'private-id' }],
  } });
  expect(events.at(-1)).toMatchObject({ text: '<script>plain text</script>', phase: 'pending' });
});

it('streams a newly inserted paragraph with its placement before its JSON is complete', () => {
  const { preview, events } = setup();
  const stream = { ...base, name: 'apply_document_operations' };
  preview.receive({ ...stream, phase: 'arguments-delta', delta: '{"operations":[{"type":"block.insert","beforeId":null,"block":{"kind":"paragraph","text":"第一' });
  expect(events.at(-1)).toMatchObject({ text: '第一', drafts: [{ text: '第一', anchor: { kind: 'document_end' } }] });
  preview.receive({ ...stream, phase: 'arguments-delta', delta: '段。"}}' });
  expect(events.at(-1)).toMatchObject({ text: '第一段。' });
});
it('keeps placement hints scoped to each writing operation', () => {
  const { preview, events } = setup();
  preview.receive({ ...base, name: 'apply_document_operations', phase: 'arguments-complete', arguments: {
    target: { kind: 'text', blockId: 'p1', start: 3, end: 3 },
    operations: [
      { type: 'text.insert', text: '续写' },
      { type: 'block.insert', position: { anchorId: 'p2', relation: 'after' }, block: { kind: 'paragraph', text: '新增段落' } },
      { type: 'block.insert', beforeId: 'p3', block: { kind: 'table', headerText: ['A', 'B'], rowsText: [['C', 'D']] } },
    ],
  } });
  expect(events.at(-1)).toMatchObject({ drafts: [
    { text: '续写', anchor: { kind: 'text', blockId: 'p1', offset: 3 } },
    { text: '新增段落', anchor: { kind: 'after_block', blockId: 'p2' }, block: { kind: 'paragraph' } },
    { text: 'A ｜ B\nC ｜ D', anchor: { kind: 'before_block', blockId: 'p3' }, block: { kind: 'table', header: true, rows: [['A', 'B'], ['C', 'D']] } },
  ] });
  const last = events.at(-1)!;
  expect(last.type === 'preview' && last.drafts![0]).not.toHaveProperty('block');
});
it('streams an article with its title and heading levels', () => {
  const { preview, events } = setup();
  preview.receive({ ...base, phase: 'arguments-delta', delta: '{"destination":{"kind":"document_end"},"title":"标题","blocks":[{"kind":"heading","level":2,"text":"小节"},{"kind":"paragraph","text":"正文' });
  expect(events.at(-1)).toMatchObject({ drafts: [
    { text: '标题', block: { kind: 'heading', level: 1 } },
    { text: '小节', block: { kind: 'heading', level: 2 } },
    { text: '正文', block: { kind: 'paragraph' } },
  ] });
});
