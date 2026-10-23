import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { prepareBrowserAudio, microphoneLevel } from '../lib/infrastructure/realtime/browser-audio';

const contexts: FakeAudioContext[] = [];
class FakeAudioContext {
  close = vi.fn(async () => {});
  resume = vi.fn(async () => {});
  source = { connect: vi.fn(), disconnect: vi.fn() };
  audioWorklet = { addModule: vi.fn(async () => {}) };
  createMediaStreamSource = vi.fn(() => this.source);
  constructor() { contexts.push(this); }
}
const worklets: FakeWorklet[] = [];
class FakeWorklet {
  constructor() { worklets.push(this); }
  port: { onmessage: ((event: { data: ArrayBuffer }) => void) | null } = { onmessage: null }; disconnect = vi.fn();
}
let stream: MediaStream, track: MediaStreamTrack, getUserMedia: ReturnType<typeof vi.fn>;
let lifetime: AbortController;
const states = vi.fn(), failure = vi.fn(), levels = vi.fn();
const createSpeaker = vi.fn(async () => ({ enqueue: vi.fn(), flush: vi.fn(async () => ({})), close: vi.fn(async () => {}) }));
const prepare = () => prepareBrowserAudio({ signal: lifetime.signal, resampler: 'class Resampler {}', createSpeaker, onMicrophone: states, onFailure: failure, onInputLevel: levels });
beforeEach(() => {
  worklets.length = 0; levels.mockClear(); contexts.length = 0; states.mockClear(); failure.mockClear(); createSpeaker.mockClear(); lifetime = new AbortController();
  track = Object.assign(new EventTarget(), { stop: vi.fn() }) as unknown as MediaStreamTrack;
  stream = { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
  getUserMedia = vi.fn(async () => stream);
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  vi.stubGlobal('AudioContext', FakeAudioContext); vi.stubGlobal('AudioWorkletNode', FakeWorklet);
  vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() }));
});
afterEach(() => { lifetime.abort(); vi.unstubAllGlobals(); });
it('requests permission once, reports actual capture, and releases tracks and contexts on disconnect', async () => {
  const audio = await prepare();
  expect(getUserMedia).toHaveBeenCalledOnce(); expect(states.mock.calls.flat()).toEqual(['requesting', 'ready']);
  await audio.input({ sampleRate: 24000 }, vi.fn()); expect(states).toHaveBeenLastCalledWith('on');
  lifetime.abort(); await audio.stop();
  expect(track.stop).toHaveBeenCalledOnce(); expect(contexts.every(context => context.close.mock.calls.length === 1)).toBe(true);
});
it.each([
  ['NotAllowedError', 'permission was denied'], ['NotFoundError', 'No usable microphone'], ['NotReadableError', 'another app'],
])('explains %s and closes audio resources without opening a speaker', async (name, message) => {
  getUserMedia.mockRejectedValueOnce(new DOMException('private details', name));
  await expect(prepare()).rejects.toThrow(message);
  expect(createSpeaker).not.toHaveBeenCalled(); expect(states).not.toHaveBeenCalledWith('on');
  expect(contexts.every(context => context.close.mock.calls.length === 1)).toBe(true);
});
it('stops a late microphone grant after cancellation and never starts capture', async () => {
  let resolve!: (stream: MediaStream) => void;
  getUserMedia.mockImplementationOnce(() => new Promise<MediaStream>(done => { resolve = done; }));
  const pending = prepare(); lifetime.abort(); resolve(stream);
  await expect(pending).rejects.toThrow();
  expect(track.stop).toHaveBeenCalledOnce(); expect(createSpeaker).not.toHaveBeenCalled(); expect(states).not.toHaveBeenCalledWith('on');
});
it('releases the microphone if a worklet cannot load', async () => {
  const audio = await prepare(); contexts[0].audioWorklet.addModule.mockRejectedValueOnce(new Error('worklet blocked'));
  await expect(audio.input({}, vi.fn())).rejects.toThrow();
  expect(track.stop).toHaveBeenCalledOnce(); expect(failure).toHaveBeenCalledWith(expect.stringContaining('Audio could not start'));
});
it('notifies the connection when the microphone is revoked or unplugged', async () => {
  await prepare(); track.dispatchEvent(new Event('ended'));
  expect(failure).toHaveBeenCalledWith(expect.stringContaining('Microphone access ended'));
});
it('explains insecure or unsupported browser contexts before requesting the microphone', async () => {
  vi.stubGlobal('isSecureContext', false);
  await expect(prepare()).rejects.toThrow('HTTPS'); expect(getUserMedia).not.toHaveBeenCalled();
});

it('measures captured audio, preserves PCM delivery, and stops level updates on disconnect', async () => {
  const audio = await prepare(); const send = vi.fn();
  await audio.input({}, send);
  const loud = new Int16Array(480).fill(8192).buffer;
  const handler = worklets[0].port.onmessage!;
  for (let i = 0; i < 3; i++) handler({ data: loud });
  expect(send).toHaveBeenCalledTimes(3);
  expect(send).toHaveBeenLastCalledWith(new Uint8Array(loud));
  expect(levels).toHaveBeenCalledOnce(); expect(levels.mock.calls[0][0]).toBeGreaterThan(0.9);
  for (let i = 0; i < 3; i++) handler({ data: new ArrayBuffer(960) });
  expect(levels).toHaveBeenLastCalledWith(0);
  await audio.stop(); const count = levels.mock.calls.length;
  handler({ data: loud });
  expect(levels).toHaveBeenCalledTimes(count); expect(send).toHaveBeenCalledTimes(6);
});
it('maps silence, quiet speech and loud input monotonically, respecting PCM offsets', () => {
  const pcm = (amplitude: number) => new Uint8Array(new Int16Array(480).fill(amplitude).buffer);
  expect(microphoneLevel(pcm(0))).toBe(0);
  expect(microphoneLevel(pcm(10))).toBe(0);
  expect(microphoneLevel(pcm(500))).toBeGreaterThan(0);
  expect(microphoneLevel(pcm(500))).toBeLessThan(microphoneLevel(pcm(4000)));
  expect(microphoneLevel(pcm(32767))).toBe(1);
  expect(microphoneLevel(new Uint8Array())).toBe(0);
  const buffer = pcm(4000); buffer.fill(0, 100);
  expect(microphoneLevel(buffer.subarray(100))).toBe(0);
});
