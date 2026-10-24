# Voice eval

Speaks a fixed set of instructions to a real vRealTime session and grades what happened to the document. Use it to compare models, prompts and settings with numbers instead of impressions.

Each case starts from the same document ([fixture.ts](fixture.ts)), streams its audio in real time through a virtual microphone, lets the agent edit through the production realtime wiring (`openDocumentRealtime`: the real executor, document tools and `DocumentEngine`), then checks the finished document.

## Run

```sh
npm run eval:voice:tts   # placeholder audio from the OS speech engine (skips existing files)
npm run eval:voice       # scripted fake model: no network, no keys, no cost
```

The fake run proves the harness end to end and must pass every case. It says nothing about any model.

### Against a deployed vdoc-server

Use a **preview** deployment. Every case starts a real, billed model session.

```sh
VOICE_EVAL_TARGET=remote \
VOICE_EVAL_SERVER_URL=https://<preview>-vdoc-server.<account>.workers.dev \
VOICE_EVAL_CLIENT_KEY=<a key from that deployment's VDOC_SERVER_CLIENTS> \
VOICE_EVAL_LABEL=boson-preview \
npm run eval:voice
```

The runner calls vdoc-server as the trusted application, the role the vdoc BFF plays: it sends the client key and `X-Vdoc-User-Id` (default `voice-eval`, set `VOICE_EVAL_USER_ID` to change it). Keep the key in your shell or a local, uncommitted env file.

To compare models, point the preview at another `VDOC_SERVER_MODEL` (`boson`, `openai`, `cascade-claude`), redeploy it, and run again with another label.

| Variable | Default | |
|---|---|---|
| `VOICE_EVAL_TARGET` | `fake` | `remote` for a deployed server |
| `VOICE_EVAL_CASES` | all | Comma-separated case IDs |
| `VOICE_EVAL_TURN_TIMEOUT_MS` | 15000 (fake), 45000 (remote) | Per spoken turn |
| `VOICE_EVAL_LABEL` | target host | Name in the report |

## Results

Reports go to `eval/voice/results/` (ignored by git) as Markdown and JSON. Per turn:

- **heard / CER**: the final user transcript and its character error rate against the utterance, ignoring spaces and punctuation.
- **first audio**: from the last voiced moment of the utterance to the first agent audio. Negative means the agent replied before the user finished (turn detection cut in on a pause). Includes turn detection, so it is what a user experiences.
- **done**: from the same moment until the agent went idle.
- **tools**: tool calls in order.
- **pass / failures**: the case's checks.

## Audio

Files are `audio/<case>-<turn>.wav` (PCM16, any rate; leading and trailing silence is trimmed). `eval:voice:tts` writes placeholders with Windows speech (`System.Speech`), macOS `say` or Linux `espeak-ng`, and never overwrites existing files unless given `--force`.

Synthesized speech is cleaner than people talking, so recognition scores from it are optimistic. For decisions, record the utterances yourself under the same file names: a quiet room, normal speed, one take each.

## Cases

[cases.json](cases.json): `utterances` are spoken in order; `turnChecks[i]` are checked after turn `i + 1`, `checks` after the last turn. Check types are in [grade.ts](grade.ts); blocks are found by text, never by ID. The fake agent's scripted answers are in [fake-agent.ts](fake-agent.ts); a new case needs one there too.
