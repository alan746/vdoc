// Voice eval: speaks each case to a real vRealTime session and grades the
// finished document. `npm run eval:voice` (fake model) or see README.md.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Editor } from '@tiptap/core';
import { ClientSession } from '@vrealtime/client';
import { afterAll, expect, it } from 'vitest';
import { createExtensions } from '../../lib/editor/extensions';
import { openDocumentRealtime } from '../../lib/composition/realtime';
import { DocumentEngine } from '../../lib/usecases/engine';
import type { RealtimePort } from '../../lib/usecases/ports';
import { placeholderSpeech, readWav, RecordingSpeaker, trimSilence, VirtualMicrophone } from './audio';
import data from './cases.json';
import { fakeScript } from './fake-agent';
import { FIXTURE_TITLE, fixtureDocument } from './fixture';
import { characterErrorRate, grade, type Check, type Grade } from './grade';
import { fakeTarget, remoteTarget, type EvalSession, type EvalTarget } from './targets';

type Case = { id: string; utterances: string[]; turnChecks?: Check[][]; checks: Check[] };
type Turn = { utterance: string; heard: string; cer: number; firstAudioMs: number | null; doneMs: number | null; toolCalls: string[]; agentSaid: string; grade?: Grade };
type Result = { id: string; pass: boolean; failures: string[]; turns: Turn[]; error?: string };

const env = process.env;
const remote = env.VOICE_EVAL_TARGET === 'remote';
const turnTimeoutMs = Number(env.VOICE_EVAL_TURN_TIMEOUT_MS ?? (remote ? 45000 : 15000));
const only = env.VOICE_EVAL_CASES?.split(',').map(id => id.trim()).filter(Boolean);
const audioDir = join(import.meta.dirname, 'audio');
const target: EvalTarget = remote
  ? remoteTarget({ serverUrl: required('VOICE_EVAL_SERVER_URL'), clientKey: required('VOICE_EVAL_CLIENT_KEY'), userId: env.VOICE_EVAL_USER_ID ?? 'voice-eval' })
  : fakeTarget();
const cases = (data.cases as Case[]).filter(c => !only?.length || only.includes(c.id));
const results: Result[] = [];

function required(name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is required when VOICE_EVAL_TARGET=remote. See eval/voice/README.md.`);
  return value;
}

function audioFor(id: string, turn: number) {
  const file = join(audioDir, `${id}-${turn + 1}.wav`);
  return existsSync(file) ? trimSilence(readWav(new Uint8Array(readFileSync(file)))) : placeholderSpeech(24000);
}

/** Everything the session reports, timestamped, for the current turn. */
class Recorder {
  events: { at: number; type: string; text?: string; role?: string; name?: string; state?: string; final?: boolean }[] = [];
  push(event: Recorder['events'][number]) { this.events.push(event); }
  since(at: number) { return this.events.filter(event => event.at >= at); }
}

/** The production realtime wiring (executor, tools, ID mapping) with an eval microphone and speaker. */
function evalPort(session: EvalSession, mic: VirtualMicrophone, speaker: RecordingSpeaker, recorder: Recorder): RealtimePort {
  return {
    open({ context, tools, signal, onStatus }) {
      const client = new ClientSession(session.url, {
        tools, context, auth: () => session.auth(), audio: { input: mic.source, output: speaker },
        ...(session.WebSocket ? { WebSocket: session.WebSocket } : {}),
      });
      const now = () => performance.now();
      client.on('ready', () => onStatus('connected'));
      client.on('closed', () => onStatus('disconnected'));
      client.on('error', event => recorder.push({ at: now(), type: 'error', text: `${event.code}: ${event.message}` }));
      client.on('state', event => recorder.push({ at: now(), type: 'state', state: event.state }));
      client.on('transcript', event => recorder.push({ at: now(), type: 'transcript', role: event.role, text: event.text, final: event.final }));
      client.on('tool.call', event => recorder.push({ at: now(), type: 'call', name: event.name }));
      client.on('tool.result', event => recorder.push({ at: now(), type: 'result', name: event.name, text: event.result.ok ? 'ok' : `${event.result.code}: ${event.result.message}` }));
      const close = () => { void client.close().catch(() => undefined); };
      signal.addEventListener('abort', close, { once: true });
      void client.start().catch(error => recorder.push({ at: now(), type: 'error', text: String(error) }));
      return { close, interrupt: reason => client.interrupt(reason), sendText: text => client.sendText(text) };
    },
  };
}

async function until(check: () => boolean, timeoutMs: number) {
  const deadline = performance.now() + timeoutMs;
  while (!check()) {
    if (performance.now() > deadline) return false;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  return true;
}

async function runCase(c: Case): Promise<Result> {
  const original = fixtureDocument();
  const editor = new Editor({ extensions: createExtensions(), content: original });
  await new Promise(resolve => setTimeout(resolve, 0));
  const engine = new DocumentEngine(editor);
  const baseline = editor.getJSON();
  const mic = new VirtualMicrophone(), speaker = new RecordingSpeaker(), recorder = new Recorder();
  const documentId = remote ? `voice-eval-${c.id}-${Date.now().toString(36)}` : c.id;
  const session = await target.open(documentId);
  let status = 'connecting';
  const connection = openDocumentRealtime({
    engine, docId: documentId, title: FIXTURE_TITLE,
    config: { url: 'wss://voice-eval.invalid', sessionsUrl: '/api/voice-sessions', language: data.language },
    onStatus: next => { status = next; },
  }, evalPort(session, mic, speaker, recorder));
  const turns: Turn[] = [];
  const failures: string[] = [];
  try {
    if (!await until(() => status === 'connected' && mic.started, 20000)) throw new Error(`the session did not connect (${status})`);
    for (const [turn, utterance] of c.utterances.entries()) {
      Object.assign(fakeScript, { caseId: c.id, turn, utterance });
      let startedAt = performance.now();
      const spokenAt = await mic.speak(audioFor(c.id, turn), at => { startedAt = at; });
      // Turn detection may end the turn mid-sentence (a pause), so everything is
      // collected from when the user started; latency counts from when they stopped.
      // The turn is over once the agent has stayed idle for 600 ms after the user stopped.
      const lastState = () => recorder.since(startedAt).filter(event => event.type === 'state').at(-1);
      const finished = await until(() => {
        const last = lastState();
        return last?.state === 'idle' && performance.now() - Math.max(last.at, spokenAt) >= 600;
      }, turnTimeoutMs);
      const events = recorder.since(startedAt);
      const heard = events.filter(event => event.type === 'transcript' && event.role === 'user' && event.final).map(event => event.text).join(' ');
      const agentSaid = events.filter(event => event.type === 'transcript' && event.role === 'agent').map(event => event.text).join('');
      const firstAudio = speaker.arrivals.find(at => at >= startedAt);
      const record: Turn = {
        utterance, heard, cer: characterErrorRate(utterance, heard),
        // Negative: the agent started replying before the user finished.
        firstAudioMs: firstAudio === undefined ? null : firstAudio - spokenAt,
        doneMs: finished ? lastState()!.at - spokenAt : null,
        toolCalls: events.filter(event => event.type === 'call').map(event => event.name!), agentSaid,
      };
      for (const error of events.filter(event => event.type === 'error')) failures.push(`turn ${turn + 1}: ${error.text}`);
      if (!finished) {
        // Enough to tell a silent model from a harness problem.
        const states = events.filter(event => event.type === 'state').map(event => event.state).join('>') || 'none';
        failures.push(`turn ${turn + 1}: no reply within ${turnTimeoutMs} ms (states ${states}; user transcript ${heard ? 'received' : 'missing'}; ${record.toolCalls.length} tool calls)`);
      }
      const checks = turn === c.utterances.length - 1 ? c.checks : c.turnChecks?.[turn];
      if (checks) {
        record.grade = grade(baseline, editor.getJSON(), agentSaid, checks);
        failures.push(...record.grade.failures.map(failure => `turn ${turn + 1}: ${failure}`));
      }
      turns.push(record);
    }
    return { id: c.id, pass: failures.length === 0, failures, turns };
  } catch (error) {
    return { id: c.id, pass: false, failures: [...failures, String(error)], turns, error: String(error) };
  } finally {
    connection.close();
    await session.end();
    engine.destroy(); editor.destroy();
  }
}

const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return Math.round(sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2);
};

function report() {
  const label = env.VOICE_EVAL_LABEL ?? target.name;
  const allTurns = results.flatMap(result => result.turns);
  const summary = {
    label, target: target.name, at: new Date().toISOString(), cases: results.length,
    passed: results.filter(result => result.pass).length,
    medianFirstAudioMs: median(allTurns.flatMap(turn => turn.firstAudioMs ?? [])),
    medianDoneMs: median(allTurns.flatMap(turn => turn.doneMs ?? [])),
    meanCer: allTurns.length ? Number((allTurns.reduce((sum, turn) => sum + turn.cer, 0) / allTurns.length).toFixed(3)) : null,
    meanToolCalls: allTurns.length ? Number((allTurns.reduce((sum, turn) => sum + turn.toolCalls.length, 0) / allTurns.length).toFixed(2)) : null,
  };
  const ms = (value: number | null) => value === null ? "—" : `${Math.round(value)} ms`;
  const lines = [
    `# Voice eval: ${label}`, '',
    `${summary.at} · target ${summary.target} · **${summary.passed}/${summary.cases} passed** · median first audio ${ms(summary.medianFirstAudioMs)} · median done ${ms(summary.medianDoneMs)} · mean CER ${summary.meanCer} · mean tool calls ${summary.meanToolCalls}`, '',
    '| case | pass | turn | heard | CER | first audio | done | tools | failures |', '|---|---|---|---|---|---|---|---|---|',
    ...results.flatMap(result => (result.turns.length ? result.turns : [undefined]).map((turn, index) => [
      index === 0 ? result.id : '', index === 0 ? (result.pass ? '✅' : '❌') : '', index + 1, turn?.heard ?? '', turn ? turn.cer.toFixed(2) : '',
      ms(turn?.firstAudioMs ?? null), ms(turn?.doneMs ?? null), turn?.toolCalls.join(', ') ?? '', index === 0 ? result.failures.join('; ') : '',
    ].map(cell => String(cell).replaceAll('|', '\\|')).join(' | ')).map(row => `| ${row} |`)),
  ];
  const dir = join(import.meta.dirname, 'results');
  mkdirSync(dir, { recursive: true });
  const stem = join(dir, `${summary.at.replace(/[:.]/g, '-')}-${label.replace(/[^A-Za-z0-9_-]+/g, '_')}`);
  writeFileSync(`${stem}.json`, JSON.stringify({ summary, results }, null, 2));
  writeFileSync(`${stem}.md`, lines.join('\n') + '\n');
  console.log(`\n${lines.join('\n')}\n\nReport: ${stem}.md`);
}

afterAll(async () => {
  await target.close();
  if (results.length) report();
});

for (const c of cases) {
  it(c.id, async () => {
    const result = await runCase(c);
    results.push(result);
    // Model quality is the report's job; a failure here means the harness itself
    // broke under the fake model, which must pass every case.
    if (!remote) expect(result.failures, c.id).toEqual([]);
  }, (turnTimeoutMs + 10000) * c.utterances.length + 30000);
}
