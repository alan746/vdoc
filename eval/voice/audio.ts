import type { AudioSink, AudioSourceFactory } from '@vrealtime/client';

const FRAME_MS = 20;

/** Mono PCM16 samples at `sampleRate`. */
export type Pcm = { samples: Int16Array; sampleRate: number };

/** Reads a PCM16 WAV file (any channel count; the first channel is used). */
export function readWav(bytes: Uint8Array): Pcm {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Not a WAV file.');
  let offset = 12, channels = 0, sampleRate = 0, bits = 0, data: Uint8Array | undefined;
  while (offset + 8 <= bytes.length) {
    const id = tag(offset), size = view.getUint32(offset + 4, true), body = offset + 8;
    if (id === 'fmt ') {
      if (view.getUint16(body, true) !== 1) throw new Error('Only uncompressed PCM WAV is supported.');
      channels = view.getUint16(body + 2, true); sampleRate = view.getUint32(body + 4, true); bits = view.getUint16(body + 14, true);
    } else if (id === 'data') data = bytes.subarray(body, body + size);
    offset = body + size + (size % 2);
  }
  if (!data || bits !== 16 || channels < 1) throw new Error('Expected 16-bit PCM audio.');
  const frames = Math.floor(data.length / (2 * channels));
  const samples = new Int16Array(frames);
  const pcm = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let i = 0; i < frames; i++) samples[i] = pcm.getInt16(i * 2 * channels, true);
  return { samples, sampleRate };
}

/** Linear resampling; good enough for speech recognition input. */
export function resample(pcm: Pcm, sampleRate: number): Int16Array {
  if (pcm.sampleRate === sampleRate) return pcm.samples;
  const length = Math.round(pcm.samples.length * sampleRate / pcm.sampleRate);
  const out = new Int16Array(length);
  for (let i = 0; i < length; i++) {
    const position = i * pcm.sampleRate / sampleRate, left = Math.floor(position), fraction = position - left;
    const a = pcm.samples[left] ?? 0, b = pcm.samples[left + 1] ?? a;
    out[i] = Math.round(a + (b - a) * fraction);
  }
  return out;
}

/**
 * Drops leading and trailing silence (20 ms windows below `threshold` RMS), so
 * "the user stopped talking" is the last voiced moment, not the end of the file.
 */
export function trimSilence(pcm: Pcm, threshold = 300): Pcm {
  const window = Math.max(1, Math.round(pcm.sampleRate / 50));
  const voiced = (start: number) => {
    let sum = 0;
    const end = Math.min(pcm.samples.length, start + window);
    for (let i = start; i < end; i++) sum += pcm.samples[i] * pcm.samples[i];
    return Math.sqrt(sum / Math.max(1, end - start)) >= threshold;
  };
  let first = 0, last = pcm.samples.length;
  while (first < last && !voiced(first)) first += window;
  while (last > first && !voiced(Math.max(first, last - window))) last -= window;
  return { samples: pcm.samples.slice(first, last), sampleRate: pcm.sampleRate };
}

/** A soft vowel-like tone, for runs without recorded or synthesized audio (the fake model ignores content). */
export function placeholderSpeech(sampleRate: number, ms = 1200): Pcm {
  const samples = new Int16Array(Math.round(sampleRate * ms / 1000));
  for (let i = 0; i < samples.length; i++) samples[i] = Math.round(6000 * Math.sin(2 * Math.PI * 180 * i / sampleRate) * Math.sin(Math.PI * i / samples.length));
  return { samples, sampleRate };
}

/**
 * A microphone that sends a 20 ms frame every 20 ms in real time, like a browser
 * would: queued speech when there is some, silence otherwise.
 */
export class VirtualMicrophone {
  #frame: ((pcm16: Uint8Array) => void) | undefined;
  #samplesPerFrame = 0;
  #sampleRate = 0;
  #queue: Int16Array[] = [];
  #timer: ReturnType<typeof setInterval> | undefined;
  #drained: (() => void) | undefined;

  /** Pass as `audio.input`. */
  readonly source: AudioSourceFactory = async (format, onFrame) => {
    // The protocol's default PCM16 rate when the server does not name one.
    this.#sampleRate = format.sampleRate ?? 24000;
    this.#samplesPerFrame = this.#sampleRate * FRAME_MS / 1000;
    this.#frame = onFrame;
    this.#timer = setInterval(() => this.#tick(), FRAME_MS);
    return { stop: async () => { clearInterval(this.#timer); this.#frame = undefined; } };
  };

  get started(): boolean { return this.#frame !== undefined; }

  /** Queues speech and resolves when its last frame has been sent: the moment the user stops talking. */
  speak(pcm: Pcm, onStart?: (at: number) => void): Promise<number> {
    onStart?.(performance.now());
    const samples = resample(pcm, this.#sampleRate);
    for (let i = 0; i < samples.length; i += this.#samplesPerFrame) {
      const frame = new Int16Array(this.#samplesPerFrame);
      frame.set(samples.subarray(i, i + this.#samplesPerFrame));
      this.#queue.push(frame);
    }
    return new Promise(resolve => { this.#drained = () => resolve(performance.now()); });
  }

  #tick() {
    const frame = this.#queue.shift() ?? new Int16Array(this.#samplesPerFrame);
    this.#frame?.(new Uint8Array(frame.buffer));
    if (this.#queue.length === 0 && this.#drained) { const done = this.#drained; this.#drained = undefined; done(); }
  }
}

/** A speaker that only records when agent audio arrives. */
export class RecordingSpeaker implements AudioSink {
  readonly arrivals: number[] = [];
  enqueue(): void { this.arrivals.push(performance.now()); }
  async flush(): Promise<Record<string, number>> { return {}; }
  async close(): Promise<void> {}
}
