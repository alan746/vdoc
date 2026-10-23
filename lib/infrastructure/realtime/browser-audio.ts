import type { MicrophoneStatus } from '../../usecases/ports';
import { microphoneError, VoiceConnectionError } from './voice-errors';

type Speaker = { enqueue(item: string, pcm: Uint8Array): void; flush(): Promise<Record<string, number>>; close(): Promise<void> };

/** Own media resources even while permission/worklet promises are pending.
 * The SDK's built-in microphone cannot cancel a pending permission request. */
export async function prepareBrowserAudio(options: {
  signal: AbortSignal; resampler: string;
  createSpeaker(rate: number, context: AudioContext): Promise<Speaker>;
  onMicrophone(status: MicrophoneStatus): void;
  onFailure(message: string): void;
  onInputLevel?(level: number): void;
}) {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || typeof AudioContext === 'undefined')
    throw new VoiceConnectionError('Voice needs HTTPS (or localhost) and a browser with microphone and Web Audio support.');
  let stream: MediaStream | undefined, inputContext: AudioContext | undefined, outputContext: AudioContext | undefined;
  let source: MediaStreamAudioSourceNode | undefined, node: AudioWorkletNode | undefined;
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    options.onInputLevel?.(0);
    options.signal.removeEventListener('abort', abort);
    stream?.getTracks().forEach(track => track.stop());
    source?.disconnect();
    if (node) { node.port.onmessage = null; node.disconnect(); }
    await Promise.allSettled([inputContext?.close(), outputContext?.close()]);
  };
  const abort = () => { void stop(); };
  const check = () => { if (stopped || options.signal.aborted) throw new DOMException('Connection cancelled.', 'AbortError'); };
  options.signal.addEventListener('abort', abort, { once: true });
  try {
    check();
    // Start/resume audio contexts inside the Connect button's user gesture.
    inputContext = new AudioContext();
    outputContext = new AudioContext({ sampleRate: 24000 });
    options.onMicrophone('requesting');
    await Promise.all([
      navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } }).then(value => {
        if (stopped || options.signal.aborted) { value.getTracks().forEach(track => track.stop()); check(); }
        stream = value;
      }),
      inputContext.resume(), outputContext.resume(),
    ]);
    check();
    options.onMicrophone('ready');
    for (const track of stream!.getAudioTracks()) track.addEventListener('ended', () => {
      if (!stopped) options.onFailure('Microphone access ended. Check your device and site permissions, then reconnect.');
    }, { once: true });
    const output = await options.createSpeaker(24000, outputContext);
    check();
    return {
      output, stop,
      input: async (format: { sampleRate?: number }, onFrame: (pcm: Uint8Array) => void) => {
        try {
          check();
          const context = inputContext!;
          const script = `const Resampler = (${options.resampler});
class Capture extends AudioWorkletProcessor {
  constructor(options) { super(); this.resampler = new Resampler(sampleRate, options.processorOptions.rate, options.processorOptions.frame); }
  process(inputs) { const channel = inputs[0]?.[0]; if (channel) for (const frame of this.resampler.push(channel)) this.port.postMessage(frame.buffer, [frame.buffer]); return true; }
}
registerProcessor('vdoc-capture', Capture);`;
          const url = URL.createObjectURL(new Blob([script], { type: 'text/javascript' }));
          try { await context.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
          check();
          const rate = format.sampleRate ?? 24000;
          node = new AudioWorkletNode(context, 'vdoc-capture', { numberOfOutputs: 0, processorOptions: { rate, frame: Math.round(rate * 0.02) } });
          let frames = 0, peak = 0;
          node.port.onmessage = ({ data }) => {
            if (stopped) return;
            const pcm = new Uint8Array(data);
            onFrame(pcm);
            // Meter only captured input, never the assistant's speaker output.
            // Publish every three 20ms frames to keep React updates inexpensive.
            if (options.onInputLevel) {
              peak = Math.max(peak, microphoneLevel(pcm));
              if (++frames === 3) { options.onInputLevel(peak); frames = 0; peak = 0; }
            }
          };
          source = context.createMediaStreamSource(stream!); source.connect(node);
          options.onMicrophone('on');
          return { stop };
        } catch (error) {
          if (!stopped) options.onFailure(microphoneError(error));
          await stop();
          throw error;
        }
      },
    };
  } catch (error) {
    await stop();
    throw error instanceof VoiceConnectionError ? error : new VoiceConnectionError(microphoneError(error));
  }
}

/** PCM16 little-endian RMS mapped from -60..-12 dBFS into a visual 0..1 range. */
export function microphoneLevel(pcm: Uint8Array): number {
  const samples = Math.floor(pcm.byteLength / 2);
  if (!samples) return 0;
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let energy = 0;
  for (let i = 0; i < samples; i++) energy += (view.getInt16(i * 2, true) / 32768) ** 2;
  const rms = Math.sqrt(energy / samples);
  return rms <= 0.001 ? 0 : Math.min(1, Math.max(0, (20 * Math.log10(rms) + 60) / 48));
}
