# Content-addressed image storage (issue #72)

Status: design-phase decision; production storage is unchanged. Based on main
`dad346695fc579009ba090cf961f5e69d4ecd032`. Implement only after the codec split in
#70 and the compatibility/transaction tests below. The design is deliberately
separate from a storage-format rollout.

## Decision and evidence

Adopt content-addressed image storage for an implementation phase. The measured
image-heavy workload justifies removing image bytes from document/version rows.
It does not justify silently changing synchronous command semantics or eagerly
migrating all user data. Use additive stores and per-record migration.

The runnable prototype is `tools/image-storage-benchmark/index.html` and
`benchmark.js`. It operates only on `vdoc-image-benchmark-inline` and
`vdoc-image-benchmark-references`; never on `vdoc.local.v2`. Serve that directory
with `python3 -m http.server 8769 --bind 127.0.0.1` and use the two links, reloading
between runs. It creates ten distinct valid PNGs (~2 MiB each), stores one document
and ten named versions, warms up five writes, measures thirty strict-durability
writes, and loads the versions. Hashing and initial blob storage are measured
separately from autosave. Generated pixels are seeded and incompressible; the
images total 21,058,142 bytes on the measured browser.

The prototype measures the storage representation, not the full application:
actual autosave also computes summaries, validates navigation, and emits changes.
It uses title edits so the image payload is unchanged. Loading all version rows
models `listVersions`, but does not include decoded images or editor/view memory.
The current native-backup parser has no artificial 20 MB cap (DOCX/TXT conversion
still does); preserve that distinction. This is an image-heavy stress case, not
a typical text document. Small documents should be measured before rollout too.

Measured on 2026-10-17 in Chromium 152 (Codex in-app browser, macOS), one run per
mode, thirty sampled writes each. Summary data is in
`tools/image-storage-benchmark/results-2026-10-17.json` (timings rounded to 0.1 ms).

| Metric | Inline data URLs | Blob references |
| --- | ---: | ---: |
| Serialized document | 28,078,209 B | 1,203 B |
| IndexedDB usage estimate, before → after | 2,770 → 308,904,552 B | 43,020 → 21,225,608 B |
| IndexedDB usage increase | 294.6 MiB | 20.2 MiB |
| Write completion, median / p95 | 38.3 / 43.8 ms | 0.5 / 0.9 ms |
| Synchronous enqueue, median / p95 | 11.1 / 13.9 ms | <0.1 / 0.1 ms |
| Initial preparation (encoding vs hashing + blob commit) | 32.7 ms | 37.2 ms |
| JS heap before → after loading ten versions | 7,020,475 → 312,737,142 B | 7,018,155 → 30,392,827 B |
| Observed JS heap increase | 291.6 MiB | 22.3 MiB |

The storage increment was ~93% smaller. Browser `storage.estimate()` is approximate,
origin-wide and asynchronously accounted; these are not exact on-disk file sizes.
The different initial counts are measured bookkeeping residue, subtracted in each
run. Heap uses non-standard `performance.memory`, without forced collection: it
includes encoding/hashing temporaries and cannot establish retained-heap savings
or peak memory. A zero enqueue sample means below the timer resolution, not free
work. Production rollout still needs controlled heap profiles and multiple-browser
measurements; the clear storage/write reduction suffices for this design decision.

## Representation and responsibilities

* `ImageRef` is `vdoc-image:` followed by 64 lowercase hex digits, the SHA-256 of
  the original binary bytes, with no recompression. Only PNG/JPEG/GIF/WebP are
  accepted, with validated signatures and a canonical MIME derived from bytes.
  A caller-supplied MIME must not create conflicting records for identical bytes.
* `images`, keyed by hash, holds `{ blob, mime, byteLength }`. It never contains an
  object URL. `StoredDocument`/version snapshots carry references; backup and
  public export DTOs continue carrying embedded images. The persistence envelope
  records an image-encoding/schema generation; do not overload the existing
  document semantic version as the sole compatibility marker.
* Domain rules validate the reference syntax and image metadata only. Existence,
  hashing, MIME validation, and persistence belong to infrastructure. Separate
  `validatePortableDocument` from a reference-aware internal validator so a backup
  cannot smuggle a foreign unresolved reference into a user's library.
* Use-case-owned ports express capabilities, not IndexedDB operations. Composition
  injects implementations; domain/editor code must not import persistence.

Proposed capability split (contract sketch, not a new public API):

```ts
interface ImageResolver {
  resolve(ref: ImageRef, signal?: AbortSignal): Promise<Blob>; // missing => typed error
}
interface ImagePreparer {
  prepare(blob: Blob, signal?: AbortSignal): Promise<PreparedImage>;
}
interface DocumentImageBoundary {
  embed(snapshot: InternalSnapshot, signal?: AbortSignal): Promise<PortableSnapshot>;
  prepare(snapshot: PortableSnapshot, signal?: AbortSignal): Promise<PreparedSnapshot>;
}
```

`PreparedImage` contains a ref plus validated immutable bytes; it is an internal,
trusted value, not an operation argument accepted from an agent. Repository writes
atomically persist prepared image records and their referencing document/version.
GC is a separate infrastructure service, not a method on the rendering resolver.
This interface segregation keeps exporters read-only and prevents UI from sweeping
storage. Pure tree conversion is shared; each boundary owns its error reporting.

## Synchronous engine and image intake

`DocumentEngine.execute` and command batches are synchronous and atomic today.
Do **not** put an async hash/IDB write in `image.insert`'s transaction or allow an
operation to return success before image bytes are safe. Add an async orchestration
boundary above the engine for upload, paste, import and agent tool calls:

1. Validate data URL/Blob size and MIME; decode and hash outside any IDB transaction.
2. Persist bytes with a session pin in one short strict transaction. Recheck the
   captured document/session identity and cancellation before dispatch.
3. Dispatch the prepared internal reference operation synchronously, rechecking
   existing revision/block preconditions and composition guards. A failed command
   releases the preparation pin; no partial editor mutation survives.
4. The next document/version write atomically verifies referenced images and writes
   rows. No crypto/file decoding awaits occur inside an open IDB transaction.

The existing synchronous public `image.insert(dataURL)` must keep working during
transition: retain its inline representation, then normalize at the repository
boundary (or explicitly version a future async API). Do not silently change its
return type. Export, undo, clipboard and reads support mixed inline/reference trees.
Prepared image refs supplied by untrusted callers are refused. An async operation
must recheck all stale/COMPOSING guards after waiting, as realtime edits do today.

## Rendering and object-URL lifetime

An image NodeView consumes an injected `ImageResolver` and an editor-scoped
reference-counted URL cache. Acquire returns `{url, release}`; equal refs share
one object URL. Changing `src` or destroying the NodeView releases exactly once.
Async resolution is guarded by generation/cancellation so an old promise cannot
replace a newer image or leak a URL after teardown. Destroying the editor releases
all consumers. Never revoke before the last consumer releases, persist blob URLs,
or substitute them into document JSON. Inline images keep the existing rendering
path. Missing/corrupt blobs show a recoverable placeholder and a specific error;
export/save must fail rather than silently omit image content.

Preview gets its own scoped resolver/cache. It survives while the preview is open
and is released on replacement/close. Native clipboard HTML and serialized HTML
cannot depend on this cache; they must embed bytes before handing off content.

## Portable boundaries

Capture one immutable editor snapshot before any await. Materialize references
once per distinct ref, honoring cancellation, then pass a portable snapshot to the
existing format strategies. Do not let exporters read a live editor or IndexedDB.

| Boundary | Conversion |
| --- | --- |
| JSON backup | Embed data URLs; no internal refs/object URLs escape |
| DOCX | Resolve original bytes or portable data URLs before existing encoder |
| HTML / clipboard HTML | Embed original bytes; retain dimensions/alt/format |
| PDF / print preview | Embed before pagination and local-PDF handoff |
| TXT | Existing text-only behavior; no image resolver needed |
| DOCX/JSON import / file upload / paste | Validate portable content, prepare bytes, commit with document |
| Version list / restore / copy / trash restore | Internal refs remain refs; verify in atomic write |

Original image bytes and document meaning remain unchanged. ZIP timestamps and
serialization details mean whole DOCX/PDF files are **not** promised byte-identical.
Legacy backups remain accepted within current size limits. Offline export must
work; unresolved references fail explicitly without downloading a partial file.

## Transactions, cross-tab writes and GC

Every writer (save, activate, import, copy, version save/restore, migration) declares
`images` plus all affected record stores in its readwrite transaction. Image
existence checks and record writes occur in that same transaction. This retains
restore's existing all-or-nothing recovery checkpoint and forty-version retention.
Use immutable images: `put` is safe only after verifying the hash, canonical MIME,
and size; corruption is an error, never an overwrite with unrelated bytes.

Mark-and-sweep scans **all** documents including trash, all retained version
snapshots, and session pins. A blob referenced only by undo/redo, a pending async
insert/export, an unsaved document or an open preview is still live. Persist pin
sets before exposing refs to the editor; release a ref only after the associated
history/consumer can no longer reference it. Document deletion is not permission
to delete an image used by another document or checkpoint.

For a first implementation use a single readwrite transaction spanning documents,
versions, images and pins for marking and deleting; IndexedDB serializes overlapping
writers, preventing a mark/write/sweep race. Scan records with cursors, not getAll
of full image-bearing legacy trees. Hashing/decoding is never performed here. If
large libraries require a chunked sweep later, introduce an explicit generation
protocol and revalidate references before each deletion; a stale external mark set
is unsafe. BroadcastChannel invalidates caches after commit; it is a notification,
not a lock and not proof that no references exist.

Do not expire suspended-tab pins on a heartbeat timeout. Crashed-session pins may
leak space until safely reconciled; correctness wins over aggressive reclamation.
A future tab/session ownership lock may recover them only after proving the owner
is gone and reconciling persisted document/version refs. If such ownership cannot
be established, retain pins and offer explicit maintenance after all editors close.
GC is skipped during migration/rollback or incompatible-client activity.

## Migration, interruption and rollback

1. Add stores in a short version upgrade; existing `onversionchange` closes old
   connections. Existing code's open-at-version-3 behavior refuses a newer DB;
   communicate that clients must reload. Keep legacy inline rows readable.
2. Cursor a bounded batch outside the upgrade transaction. Read row and its exact
   generation, validate, prepare hashes/bytes asynchronously. Reopen a short
   readwrite transaction, compare generation/content against the read, and atomically
   store images plus transformed row and migration marker. Changed rows are skipped
   and retried. A version row includes legacy `document` and current `snapshot`
   forms. IDs, sequence, timestamps and metadata are preserved.
3. Resume on startup/idle. Deterministic hashes plus atomic markers make replays
   idempotent. Never set a global completion flag before all eligible rows commit.
   Bad data/quota failures leave the original row untouched and an actionable error.
4. Rollback is a **forward** compatibility release, not an IndexedDB version
   downgrade. Materialize refs back to inline rows while retaining the blob store,
   validate exports, and only later remove unused blobs. Pause GC during this pass.
   Old application binaries must not open new reference rows unknowingly. Before
   rollout provide a self-contained backup and retain original records only within
   a bounded, quota-checked rollback window, never a hidden full-library duplicate.

Insufficient space can also block rollback because inline snapshots are larger.
Estimate headroom first; offer export to disk rather than destructive cleanup.
No failed migration/rollback removes its source records or their last image copy.

## Quota and rollout gates

With B bytes of distinct images and V versions, inline image payload is roughly
`4/3 × B × (V+1)`; blobs are `B + O(refs × (V+1))`. At 40 retained versions the
potential gap is larger. Images shared across documents dedupe too. Object URLs
avoid base64 strings but decoded pixel/GPU buffers remain proportional to displayed
images, so storage savings are not total-renderer memory savings. `estimate()` is
approximate and origin-wide; quota is browser/OS dependent, not a fixed guarantee.
Transient hashing, import, export, and migration still need bounded batches and
headroom. A quota error must leave existing saved documents usable.

Before implementation merges, require contract tests for dedupe, wrong MIME/hash,
missing blobs, mixed/legacy formats, atomic abort/quota failure, cancellation and
stale session after preparation, cross-tab writer versus GC, suspended tabs,
undo/redo-only images, trash and version retention, interrupted migration and
rollback, and object-URL release after async unmount. Round-trip JSON/DOCX/HTML
and preview/PDF with offline images; inspect real browser output. Run the existing
persistence contract, import/export, native undo, workspace and full CI suites.
