import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { prepareBrowserAudio } from '../lib/infrastructure/realtime/browser-audio';

const contexts: FakeAudioContext[] = [];
class FakeAudioContext {
  close = vi.fn(async () => {});
  resume = vi.fn(async () => {});
  source = { connect: vi.fn(), disconnect: vi.fn() };
  audioWorklet = { addModule: vi.fn(async () => {}) };
  createMediaStreamSource = vi.fn(() => this.source);
  constructor() { contexts.push(this); }
}
class FakeWorklet {
  port = { onmessage: null }; disconnect = vi.fn();
}
let stream: MediaStream, track: MediaStreamTrack, getUserMedia: ReturnType<typeof vi.fn>;
let lifetime: AbortController;
const states = vi.fn(), failure = vi.fn();
const createSpeaker = vi.fn(async () => ({ enqueue: vi.fn(), flush: vi.fn(async () => ({})), close: vi.fn(async () => {}) }));
const prepare = () => prepareBrowserAudio({ signal: lifetime.signal, resampler: 'class Resampler {}', createSpeaker, onMicrophone: states, onFailure: failure });
beforeEach(() => {
  contexts.length = 0; states.mockClear(); failure.mockClear(); createSpeaker.mockClear(); lifetime = new AbortController();
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
