# Voice editing architecture

## Goals and boundaries

Support voice-driven document work while preserving precise targets, user input, ownership, cancellation, and recoverable history. Keyboard and mouse editing share the same document state.

- The engine owns validated operations, revisions, atomicity, and undo.
- Use cases expose repository ports and the document-tool catalog.
- `RealtimePort` defines the application-facing connection contract.
- The transport adapter handles SDK events and audio resources.
- Composition connects transport, engine, and workspace.
- Server handlers authenticate users, authorize documents, and proxy lifecycle calls.

Credentials stay on the server. Browser tools use public schemas and explicit targets. Document content is content rather than executable configuration.

## Lifecycle and editing

Read authorized configuration on workspace open. Create a session and acquire the microphone only when the user connects. Release resources on disconnect, cancellation, or unmount.

Reconnection retains the authorized user and room. Obsolete calls and late grants must not revive closed sessions. Map quota failures to stable messages and valid retry information.

Freeze relevant selection context for each turn. Read targets, honor preconditions, and reread after stale responses. Keep repeated IDs idempotent. Use turn undo rather than restoring an old whole-document snapshot.

Show progress and stream previews without persisting provisional content. Validate final operations before committing. Interruption aborts obsolete work and removes provisional rendering.

## Acceptance

Cover lifecycle, microphone denial, reconnect, interruption, stale targets, streaming, undo, persistence, and user isolation. Transport fixtures and deployed workflows are separate evidence layers.

See [protocol](REALTIME_PROTOCOL.md), [operations](OPERATIONS.md), and [identity validation](VOICE_USER_IDENTITY_VALIDATION.md).
