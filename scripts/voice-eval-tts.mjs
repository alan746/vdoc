// Synthesizes placeholder audio for the voice eval with the OS speech engine:
// eval/voice/audio/<case>-<turn>.wav. Existing files (such as real recordings)
// are kept unless --force is given. Placeholders read more cleanly than people
// speak, so treat recognition scores from them as optimistic.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', 'eval', 'voice');
const { language, cases } = JSON.parse(readFileSync(join(root, 'cases.json'), 'utf8'));
const force = process.argv.includes('--force');
const outDir = join(root, 'audio');
mkdirSync(outDir, { recursive: true });

const jobs = cases.flatMap(c => c.utterances.map((text, index) => ({ text, file: join(outDir, `${c.id}-${index + 1}.wav`) })))
  .filter(job => force || !existsSync(job.file));
if (!jobs.length) { console.log('All audio files exist; use --force to regenerate.'); process.exit(0); }

if (process.platform === 'win32') {
  // One PowerShell process; text travels in a UTF-8 JSON file, never on the command line.
  const list = join(tmpdir(), `voice-eval-tts-${process.pid}.json`);
  writeFileSync(list, JSON.stringify({ language, jobs }), 'utf8');
  const script = `
    Add-Type -AssemblyName System.Speech
    $spec = Get-Content -Raw -Encoding UTF8 -LiteralPath $env:VOICE_EVAL_TTS_LIST | ConvertFrom-Json
    $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
    $voice = $synth.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -eq $spec.language } | Select-Object -First 1
    if (-not $voice) { throw "No installed Windows voice for $($spec.language). Add one in Settings > Time & language > Speech." }
    $synth.SelectVoice($voice.VoiceInfo.Name)
    $format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(24000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
    foreach ($job in $spec.jobs) { $synth.SetOutputToWaveFile($job.file, $format); $synth.Speak($job.text) }
    $synth.SetOutputToNull(); $synth.Dispose()
    Write-Output "voice: $($voice.VoiceInfo.Name)"`;
  try {
    console.log(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { env: { ...process.env, VOICE_EVAL_TTS_LIST: list }, encoding: 'utf8' }).trim());
  } finally { rmSync(list, { force: true }); }
} else if (process.platform === 'darwin') {
  for (const job of jobs) execFileSync('say', ['-v', language.startsWith('zh') ? 'Tingting' : 'Samantha', '-o', job.file, '--file-format=WAVE', '--data-format=LEI16@24000', job.text]);
} else {
  for (const job of jobs) execFileSync('espeak-ng', ['-v', language.startsWith('zh') ? 'cmn' : 'en-us', '-w', job.file, job.text]);
}
console.log(`Wrote ${jobs.length} file(s) to ${outDir}`);
