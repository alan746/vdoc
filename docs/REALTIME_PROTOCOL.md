# Realtime document protocol

This guide describes the application contract. `lib/usecases/ports.ts`, `lib/usecases/realtime-executor.ts`, and `lib/usecases/document-tools.ts` define its executable interfaces.

## Transport boundary

`RealtimePort.open()` receives configuration, document context, tools, an abort signal, and status/activity callbacks. It returns a connection with `interrupt()`, `sendText()`, and `close()`.

`lib/infrastructure/realtime/vrt-adapter.ts` connects this contract to `@vrealtime/client`. Composition injects the transport, and tests use a separate fixture adapter. The executor depends on a narrow engine port rather than a Tiptap editor instance.

Tool execution context includes `signal`, `callId`, `turnId`, and `epoch`. The SDK manages transport ordering and epoch cancellation. The executor checks cancellation, document/session binding, composition, idempotency, and validated document operations.

## Authorized sessions

Cloud workspaces read `GET /api/voice-sessions?documentId=...` to obtain authorized connection configuration. This read checks login, document ownership, and deployment settings; it does not create a session or open the microphone.

Connecting creates the session and requests microphone access. Local documents offer migration guidance. Reject trashed or unauthorized cloud documents. Keep browser-supplied legacy connection settings from overriding server-derived configuration.

The server proxies creation, renewal, and ending with the trusted user and authorized transport room. Use independent request IDs for upstream calls. Application credentials remain on the server. Configuration uses `VDOC_SERVER_URL` and `VDOC_SERVER_CLIENT_KEY` alongside authentication and database settings.

## Lifecycle and failures

Expose connecting, connected, reconnecting, disconnected, and error states alongside actual microphone state. Distinguish denied permission, unavailable devices, busy devices, and insecure origins. Cancelled or closed connections release listeners, audio, sockets, and pending work; late permission results cannot restart capture.

Recoverable service errors may show a retry hint without closing the connection. Authentication, renewal, audio, terminal, and quota errors use their defined cleanup paths. Sanitize upstream details before showing application messages.

Map only recognized quota categories and valid retry seconds. The UI does not invent remaining minutes or reset times without a backend balance contract. See [trusted identity validation](VOICE_USER_IDENTITY_VALIDATION.md).

## Document tools

| Tool | Role |
| --- | --- |
| `read_document` | Read current document snapshot |
| `read_blocks` | Read selected stable blocks |
| `get_context` | Read outline, turn-frozen selection, and recent edits |
| `apply_document_operations` | Apply explicit validated operations |
| `insert_structured_article` | Insert a validated structured article |
| `undo_turn` | Safely reverse a retained turn |

The shared catalog owns names, schemas, descriptions, and read-only metadata. Browser tools and voice tools keep their distinct execution/identity contracts. Read current targets before editing. Stale preconditions require rereading and reassessing the requested change.

## Streaming and progress

The pinned SDK supports negotiated `tool-stream-v1` and `global-tool-ids-v1`. Stream events describe start, argument deltas, completion, progress, and terminal outcomes. They drive display; only a complete tool call invokes the write path.

Activity tracks turn state, calls, results, interruption, text, and stream progress. Status lights and the voice bar show listening, processing, reading, and editing. Destination-aware provisional content can appear in the editor with its expected structure; incomplete or unresolved destinations can stay in the voice preview.

Provisional rendering does not change saved content, IDs, or undo history. Failure, interruption, disconnect, and obsolete turns remove or stop the corresponding preview. Final content is validated and committed atomically.

## Interruption and undo

Local interruption closes the current epoch synchronously. Closed-epoch calls do not execute, and running calls receive an aborted signal. Waiting for composition also observes cancellation. Late results and obsolete stream events must not update a new turn.

Turn undo uses mapped inverse steps rather than whole-document restoration. It preserves later user input where possible and rejects unsafe structural conflicts. Ordinary user history remains separate from turn identity.

## Deployment and acceptance

Deploy trusted-user backend support before the proxy. End legacy shared sessions and reconnect instead of guessing user ownership. Rollback must preserve document authorization; disable voice configuration if an older proxy cannot meet the identity contract.

Test creation/renewal/end, permissions, reconnect, interruption, quota mapping, user isolation, stale edits, streaming, undo, and persistence. Fixture tests and live deployed browser workflows remain separate evidence layers.

See [operations](OPERATIONS.md), [cloud workspace](CLOUD_WORKSPACE.md), [sign-in](GOOGLE_SIGN_IN.md), and [deployment](NEON_DEPLOYMENT.md).
