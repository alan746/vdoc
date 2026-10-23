# Owner-scoped cloud documents

Depends on the Neon schema and Google sign-in PRs. All endpoints run in the
`vdoc` Cloudflare Worker. `vdoc-server` remains the voice/realtime service.
This stage adds the API; the existing editor still uses local storage until the
separate cloud workspace/sync change is enabled.

## Identity and safety

The owner is taken exclusively from the verified database session. Every query
includes `owner_id`. Requests also send `X-Vdoc-Account: <current user id>` to stop
an old tab from syncing account A's data after the cookie switches to account B.
This header cannot establish identity. Unauthenticated requests fail with 401;
a stale account header fails with 409. There is no public sharing in this version.

POST requires the request origin to match the app origin. JSON input is strictly
validated and bounded to 8 MiB, including streamed requests. Document bodies pass
the same format, tree and editor schema validation as imported VDoc backups.
Credentials and database error details never appear in responses. Responses are
private/no-store. Do not expose DATABASE_URL to clients.

## Protocol

- `GET /api/library?after=<id>`: up to 100 metadata rows plus `nextCursor`.
  Includes deletion tombstones, excludes document bodies.
- `GET /api/library/:id`: one complete document or folder. Foreign-owner and
  permanently deleted IDs both return 404.
- `GET /api/library/:id/versions`: up to 200 checkpoint summaries, newest first.
- `POST /api/library`: one command, returning `{ item }` with the committed revision.

Commands:

| action | Additional fields |
| --- | --- |
| `put` | `id`, `expectedRevision`, `kind`, `title`, `parentId`, `starred`, `content`, `formatVersion` |
| `trash`, `restore`, `delete` | `id`, `expectedRevision` |
| `checkpoint` | `id`, `expectedRevision`, `versionId`, `label` |
| `restoreVersion` | `id`, `expectedRevision`, `versionId` |

Use `expectedRevision: 0` only for creation. Existing items require their last
observed positive revision. A conflicting save returns 409 `REVISION_CONFLICT`;
clients must preserve local edits and ask for resolution, never silently retry
with the newer revision. `ACCOUNT_CHANGED` similarly requires reopening the
workspace under the intended account. An uncertain network result must be
reconciled by reading the item/checkpoint before retrying.

Documents use `formatVersion: 1` and a Tiptap JSON document; folders use null for
both `content` and `formatVersion`. Existing item kinds are immutable. Parent
folders must be active and owned by the current user. Cycles are rejected.

Trashing a folder marks its active descendants with one group. Restoring it only
restores descendants from that group; previously trashed files stay in Trash.
A restored item whose parent is unavailable moves to the root. Permanent deletion
currently applies to documents in Trash: it erases the body/name and checkpoints,
retaining only the ID/revision tombstone so an offline device cannot resurrect it.
Database backups follow Neon's configured retention policy independently.

Checkpoint bodies are copied server-side from the current document. Restoring a
checkpoint requires the latest document revision, first saves a backup of the
current body, and writes a new revision; all steps commit together.
The 200-checkpoint cap rejects additional checkpoints explicitly; it never deletes
history silently. Checkpoints do not yet support a separate download endpoint.

Voice create/renew/end now check this same database ownership instead of the
manual `VDOC_VOICE_DOCUMENT_ACCESS` binding. Only active cloud documents can use
voice. The upstream document/room ID is a SHA-256 namespace of user ID and local
document ID, preventing different users with identical imported IDs from sharing
a voice room. The browser retains its original document ID and receives a
separate transport ID for the verified WebSocket path. This requires no voice
backend schema changes. Existing voice sessions should be restarted after rollout.

## Transactions and deployment

Neon HTTP remains the login/query adapter. Hierarchy mutations use a request-scoped
Neon WebSocket connection for interactive PostgreSQL transactions. Each write
locks the authenticated user's row before checking revisions or traversing the
tree. This serializes that user's mutations across Worker instances and prevents
concurrent parent changes from creating cycles. Different users have independent
locks. Statements have a 10-second timeout; errors roll back, and connections are
released and closed before the request completes.

No extra migration is needed beyond the foundation. The production connection
still requires a real Neon branch and the runtime DATABASE_URL secret. Automated
tests run the HTTP boundary and SQL in PGlite: user separation, forged owners,
stale account headers, bad documents, parent isolation/cycles, competing revisions,
trash groups, history, deletion tombstones, rollback and pagination. These tests
do not replace an integration check against live Neon over Cloudflare WebSockets.
