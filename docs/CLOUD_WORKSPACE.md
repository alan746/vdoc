# Account-owned cloud workspace

Backend: Cloudflare web Worker; identity and document storage: Neon PostgreSQL.
The separate voice Worker still uses Durable Objects for live voice sessions.
Apply the schema and Google configuration in `NEON_DEPLOYMENT.md` and
`GOOGLE_SIGN_IN.md` before enabling a production cloud workspace.

## Routes and local documents

- `/` is the existing anonymous browser-local workspace.
- `/account` signs in/out and links to `/cloud`.
- `/cloud` verifies the signed account session, selects its own IndexedDB cache,
  then opens the same editor/library through the cloud repository ports.
- Switching workspace modes uses a full page load so an old editor cannot save
  through a newly selected account repository.

Local documents are never silently uploaded or claimed by whoever signs in next.
Export a `.vdoc.json` from the local workspace, open the cloud workspace and import
it. Imports receive new cloud IDs. Named local checkpoints are not imported.
An already open cloud editor can save offline to its account-specific cache;
opening a new cloud workspace requires connectivity to verify the login first.
Account caches persist in that browser profile after logout so unsynced edits are
not destroyed. These caches are not encrypted: people who share a browser/OS
profile can access its local storage. Use separate profiles on shared devices.

## Sync and conflict behavior

Autosave first commits a durable IndexedDB transaction, then uploads the document
with its last acknowledged server revision. The lower editor status reports local
saving; the upper cloud bar reports uploads, failures and conflicts. Wait until the
cloud bar reports no pending edits before switching devices. Existing opened/cached
documents can be edited offline; create, import, folder operations, Trash and
checkpoints require an online server response. Each cloud upload is limited to
8 MiB; larger documents remain local pending copies that can be exported.

Reconnect, focus, and a 15-second poll retry pending uploads and check the open
cloud document. Reopen the library to refresh its listing. Stale editor tabs stop
saving when notified; revision checks also reject changes from another device.
Local cache transactions reject stale same-browser writes. Web Locks serialize
uploads between tabs where supported; server revision checks remain authoritative.

The account cache keeps its existing database name and uses IndexedDB version 2.
A `syncState` index on the existing item rows lets status reads inspect only keys;
uploads load bodies only for queued IDs. The derived index key and body are written
in the same transaction, and unchanged records are not rewritten. The v1 upgrade
scans existing rows once, indexes pending/conflicting copies, and preserves active
selection and drafts atomically. Older open tabs close their database connection
on upgrade and must reload to use the new cache version. The library listing still
reads complete cached rows; it is separate from the periodic synchronization path.

There is no last-write-wins overwrite and no automatic collaborative merge. A
conflict keeps the local copy intact. Open **Resolve conflicts**, download the
local copy, then choose **Use cloud copy**. Import the downloaded copy as a new
cloud document if both versions should be retained. A newer edit in another tab
cancels discard, so it must be reviewed again. Deleted server documents cannot be
resurrected by an offline editor. A lost upload response is reconciled with the
server content before declaring a conflict.

Every request supplies the tab's expected account ID, which is checked against
the verified server session. A login switch/expiry blocks uploads from the old tab;
its pending data stays in the original account cache. Sign in to that account and
reopen the workspace. Account headers are not credentials.

Cloud folders, stars, Trash and checkpoint history use the owner-scoped API.
Restoring a checkpoint saves a server-side backup first. There is a 200-checkpoint
limit; history is not silently pruned. Moving/trashing/restoring while local edits
are pending requires those edits to sync or their conflicts to be resolved first.

## Validation and release gate

Automated sync tests bridge the real HTTP API to PGlite (a PostgreSQL engine) and
use independent IndexedDB factories for separate devices. They cover offline
reopen, two-device conflicts, response loss, edits during uploads, stale browser
tabs, account switching, remote deletion, checkpoint restore and cache failures.
Worker smoke covers SSR/assets and unconfigured auth without production secrets.

Before public release, on a test Neon branch and configured Google test app:

1. Migrate and deploy; sign in from two browser profiles using different Google
   accounts. Create a document for each; verify neither can read the other's ID.
2. Sign in to the same account on another device and open a cloud document.
   Edit on the first device, wait for sync, and reopen on the second.
3. Go offline in an already open editor, type, reconnect and confirm persistence.
4. Edit the same revision offline on both devices; reconnect and confirm one gets
   a preserved local conflict copy. Download and re-import it.
5. Switch accounts with an old tab open; its edits must not enter the new account.
6. Create a voice session from a cloud document, exercise tools, then end it.
   Confirm logout and another account cannot authorize that document.

These checks need real Neon/Google/voice credentials and are not represented as
completed by the local test suite. Merge the dependent PRs in order: schema,
authentication, library API, cloud workspace. Do not expose production credentials
to unreviewed preview deployments.

### Voice editing in local documents

Signed-in users can connect voice from either a local or cloud document. Local
files remain in the browser repository; connecting does not import them into the
cloud library. Audio and document context returned by tools are sent to the AI
service. The voice entry explains this before microphone access.

Local session requests carry `workspace: "local"` through discovery, creation,
grant renewal and deletion. The Worker derives a separate `local_` transport ID
from the authenticated user and document ID. It does not accept caller-supplied
user IDs or transport IDs. Cloud mode remains the default and still checks the
owned, non-trashed cloud library record. Both modes forward the same trusted user
identity to the voice backend for quotas and require same-origin requests. Local
mode never authorizes access to a cloud document or another user's voice room.

Acceptance after deployment: sign in, open a local document, connect voice, ask
for a three-row/two-column table, and reload to verify local persistence. Verify
that no matching document is created in the cloud library. Check an unsigned-in
browser shows a sign-in prompt. This requires a live microphone/provider test;
the automated SDK/engine tests use a simulated transport.
