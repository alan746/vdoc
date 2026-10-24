import { VirtualClock, fakeModel, type FakeSession } from '@vrealtime/testing';
import { FIXTURE_TEXTS as T } from './fixture';

type RealtimeEvent = Parameters<FakeSession['emit']>[0];
type Call = { name: string; arguments: Record<string, unknown> };
/** What the scripted agent does next in this turn, given the tool results so far. */
type Step = { say?: string; calls?: Call[] };
type Snapshot = { sessionId: string; revision: number; blocks: { id: string; type: string; text: string; from: number; to: number }[] };
type Context = Snapshot & { recentEdits: { turnId: string }[] };

/** The utterance the runner is about to speak; the fake model "hears" it from here. */
export const fakeScript = { caseId: '', turn: 0, utterance: '' };

const read: Step = { calls: [{ name: 'read_document', arguments: {} }] };
const block = (s: Snapshot, text: string) => {
  const found = s.blocks.find(b => b.text.includes(text));
  if (!found) throw new Error(`fake agent: no block contains "${text}"`);
  return found;
};
const apply = (s: Snapshot, target: unknown, operations: unknown[]): Step => ({
  say: '好的，我来改。',
  calls: [{ name: 'apply_document_operations', arguments: { expectedSessionId: s.sessionId, expectedRevision: s.revision, target, operations } }],
});
const style = (s: Snapshot, text: string, style: Record<string, boolean>) =>
  apply(s, { kind: 'block', id: block(s, text).id }, [{ type: 'text.style', style }]);
const insert = (s: Snapshot, anchor: string, beforeId: string | null, inserted: unknown) =>
  apply(s, { kind: 'block', id: block(s, anchor).id }, [{ type: 'block.insert', beforeId, block: inserted }]);

/** A correct agent for each case: proves the harness end to end, not any model. */
const plans: Record<string, (turn: number, results: unknown[]) => Step> = {
  'bold-first-paragraph': (_, [s]) => s ? style(s as Snapshot, T.intro, { bold: true }) : read,
  'italic-by-section': (_, [s]) => s ? style(s as Snapshot, T.pain, { italic: true }) : read,
  'insert-under-heading': (_, [s]) => s ? insert(s as Snapshot, T.phase1, block(s as Snapshot, T.budget).id, { kind: 'paragraph', text: '第二阶段将在下个月开始。' }) : read,
  'append-at-end': (_, [s]) => s ? insert(s as Snapshot, T.total, null, { kind: 'paragraph', text: '谢谢大家。' }) : read,
  'insert-table': (_, [s]) => s ? insert(s as Snapshot, T.total, null, { kind: 'table', rows: 3, cols: 2, header: true }) : read,
  'heading-level': (_, [s]) => s ? apply(s as Snapshot, { kind: 'block', id: block(s as Snapshot, T.background).id }, [{ type: 'paragraph.style', level: 1 }]) : read,
  'replace-text': (_, [s]) => {
    if (!s) return read;
    const target = block(s as Snapshot, T.total), start = target.text.indexOf('十万元');
    return apply(s as Snapshot, { kind: 'text', blockId: target.id, start, end: start + 3 }, [{ type: 'text.replace', text: '十五万元' }]);
  },
  'delete-asks-first': () => ({ say: '确定要删除第一阶段那一段吗？' }),
  'delete-after-yes': (turn, [s]) => {
    if (turn === 0) return { say: '确定要删除第一阶段那一段吗？' };
    if (!s) return read;
    const target = block(s as Snapshot, T.phase1);
    return apply(s as Snapshot, { kind: 'block', id: target.id }, [{ type: 'block.delete', id: target.id }]);
  },
  'undo-last-edit': (turn, [s]) => {
    if (turn === 0) return s ? style(s as Snapshot, T.intro, { bold: true }) : read;
    if (!s) return { calls: [{ name: 'get_context', arguments: {} }] };
    const context = s as Context;
    return { say: '好的，我来撤销。', calls: [{ name: 'undo_turn', arguments: { targetTurnId: context.recentEdits[0]?.turnId, expectedSessionId: context.sessionId, expectedRevision: context.revision } }] };
  },
  'mixed-language': (_, [s]) => s ? style(s as Snapshot, T.total, { bold: true }) : read,
  'self-correction': (_, [s]) => s ? style(s as Snapshot, T.total, { bold: true }) : read,
  'bullet-list': (_, [s]) => {
    if (!s) return read;
    const snapshot = s as Snapshot;
    return apply(snapshot, { kind: 'range', from: block(snapshot, T.need).from, to: block(snapshot, T.pain).to }, [{ type: 'list.toggle', kind: 'bullet' }]);
  },
  'question-only': (_, [s]) => s ? { say: '一共有四个标题。' } : read,
};

const PCM = { encoding: 'pcm16', sampleRate: 24000, channels: 1 } as const;
const loud = (data: Uint8Array) => {
  // Frames can start at an odd byte offset inside the received message.
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength), count = Math.floor(data.byteLength / 2);
  let sum = 0;
  for (let i = 0; i < count; i++) { const sample = view.getInt16(i * 2, true); sum += sample * sample; }
  return Math.sqrt(sum / Math.max(1, count)) > 500;
};
const parse = (output: unknown) => {
  if (typeof output !== 'string') return output;
  try { return JSON.parse(output) as unknown; } catch { return output; }
};

/** A scripted realtime model with server-side turn detection (700 ms of silence ends a turn). */
export function fakeAgentModel() {
  const clock = new VirtualClock();
  const timer = setInterval(() => clock.advance(10), 10);
  let counter = 0;
  const model = fakeModel({
    clock,
    capabilities: { turnDetection: { server: true }, inputTranscription: true, tools: { autoReplyAfterResult: false } },
    onCommand(command, session) {
      const state = turns.get(session) ?? { speaking: false, lastVoice: 0, results: [] as unknown[] };
      turns.set(session, state);
      if (command.type === 'sendAudio') {
        const now = clock.now();
        if (loud(command.chunk.data)) {
          if (!state.speaking) { state.speaking = true; session.emit({ type: 'input.speech.start', atMs: now }); }
          state.lastVoice = now;
        } else if (state.speaking && now - state.lastVoice > 700) {
          state.speaking = false; state.results = [];
          session.emit({ type: 'input.speech.end', atMs: now });
          session.emit({ type: 'input.transcript', itemId: `u${++counter}`, text: fakeScript.utterance, final: true });
          respond(session, state.results);
        }
      } else if (command.type === 'submitToolResult') state.results.push(parse(command.output));
      else if (command.type === 'respond') respond(session, state.results);
    },
  });
  const turns = new Map<FakeSession, { speaking: boolean; lastVoice: number; results: unknown[] }>();
  function respond(session: FakeSession, results: unknown[]) {
    const plan = plans[fakeScript.caseId];
    let step: Step;
    // Every plan is at most one read and one write; after both, report back.
    try { step = results.length >= 2 ? { say: '改好了。' } : plan ? plan(fakeScript.turn, results) : { say: '我不知道怎么做。' }; }
    catch (error) { step = { say: String(error) }; }
    const id = `r${++counter}`;
    const events: RealtimeEvent[] = [{ type: 'response.start', responseId: id }];
    if (step.say) events.push(
      { type: 'output.transcript', responseId: id, itemId: `${id}-a`, delta: step.say },
      { type: 'output.audio', responseId: id, itemId: `${id}-a`, chunk: { data: new Uint8Array(960), format: PCM, durationMs: 20 } },
    );
    (step.calls ?? []).forEach((call, index) => events.push({ type: 'tool.call', responseId: id, callId: `${id}-c${index}`, name: call.name, arguments: call.arguments }));
    events.push({ type: 'response.end', responseId: id, status: 'done' });
    // A little model latency, so timings are measured rather than zero.
    events.forEach((event, index) => session.schedule(event, 150 + index));
  }
  return { model, stop: () => clearInterval(timer) };
}
