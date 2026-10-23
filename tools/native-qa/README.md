# Isolated native QA host

## Safari regression runners

With Safari's remote automation already enabled on this machine, run one at a time:

```sh
python3 tools/native-qa/safari_acceptance.py --check --manifest "${VDOC_QA_EVIDENCE:-qa-evidence}/preview-failure-cleanup-20261011/source-manifest.json"
python3 tools/native-qa/safari_acceptance.py --extended --manifest "${VDOC_QA_EVIDENCE:-qa-evidence}/preview-failure-cleanup-20261011/source-manifest.json"
```

These runners create and close their own Safari WebDriver session on port 4181;
they refuse to attach to an occupied driver port. The preview runner checks its
candidate manifest before running. Refresh that manifest in a new evidence set
after product changes; preserve earlier manifests as historical evidence.
The explicit manifest above includes the production image-wait visibility fix.
Omitting it still selects the historical baseline and deliberately rejects that
changed file. `safari_pinned_headers.py` also remains tied to its historical
candidate; do not treat its earlier results as a rerun of the current build.

`node tools/native-qa/preview-image-visibility.cjs` is a separate, append-only
evidence runner for the image fix. It uses real image requests and decoding in
owned Chrome pages, with controlled visibility signals. It neither manipulates
personal tabs nor certifies native Safari background behavior. The destination
refuses overwriting a completed run.

`python3 tools/native-qa/safari_image_background.py` runs the production image
wait helper in two owned Safari tabs. It serves only the fixed fixture's image
on a temporary loopback server, holds the response beyond the 15-second default
budget, and requires observed native hidden/visible events before passing.
Unlike the Chrome helper test it does not override visibility properties. It
still tests the helper separately from the full preview: VDoc imports correctly
reject external image URLs, so the harness must not loosen that validation.
Each run writes a new timestamped evidence directory and closes its own tabs,
driver and server. Earlier incomplete runs remain in the evidence set.

The extended runner checks search at 100/125%, three preview openings, last-page
navigation, all 36 sample table rows, loaded images and exact saved JSON after
reload. The pinned-header runner checks real pointer hits, native mouse selection
and row-action placement at 75/100/125% and three table scroll positions.
Neither runner certifies a system IME candidate window or native macOS PDF.
Safari 26.6.2 returned `unknown command` for WebDriver PDF printing; re-probing
that optional endpoint requires `--probe-print`, and is not a native print pass.

## Separate WebKit host

Development-only macOS WebKit host; not shipped with VDoc and not a Safari substitute.
It loads the normal localhost application in a uniquely identified persistent
`WKWebsiteDataStore` (`36A96756-6C93-43C3-932C-A4969A453A88`). It neither reads Safari
profiles nor injects JavaScript into the page.

Build with the installed Xcode toolchain:

```sh
mkdir -p 'tmp/native-qa/VDoc QA.app/Contents/MacOS' tmp/native-qa/downloads
cp tools/native-qa/Info.plist 'tmp/native-qa/VDoc QA.app/Contents/Info.plist'
xcrun swiftc -module-cache-path /tmp/vdoc-swift-cache tools/native-qa/main.swift \
  -o 'tmp/native-qa/VDoc QA.app/Contents/MacOS/VDocQA' -framework Cocoa -framework WebKit
```

Launch and interact through the native UI controller. The QA menu can select
the next fixed fixture (A: input/search, B: original print sample). Then use
VDoc's normal Import control. The file-input delegate supplies that selected
fixture. Downloads initiated by VDoc are saved with unique names beneath
`tmp/native-qa/downloads/` without replacing earlier evidence.

The QA crash action sends SIGKILL **only to this host's own PID**, after writing
its timestamp and isolated store ID to `tmp/native-qa/events.log`. It cannot
terminate Safari or other apps. Relaunch uses the same persistent store.
For an immediate-input case, the QA menu can arm a crash 150 ms after the next
unmodified key received by this application. It returns that real event normally
and schedules only the host termination; it does not synthesize input or log
typed characters. This establishes host-event timing, not the exact IndexedDB
transaction phase.

A host crash does not prove a storage-service process was killed during an
IndexedDB transaction. Record what was actually interrupted and compare real
downloaded backups. Native IME requires an observed OS candidate window; text
paste is not equivalent. This harness sets no storage quota, so it cannot by
itself certify real quota exhaustion or Safari's native print output.

The QA menu also exposes `Activate VDoc test window` and `Input source for VDoc`.
The latter lists the keyboard sources of the focused WebKit text input context
through public `NSTextInputContext` APIs. It refuses contexts whose client view
is outside this host's WebKit view. It does not synthesize composition events or
marked text. Observe the actual conversion/candidate UI and verify a downloaded
backup before claiming input persistence. The source-selection log alone is not
IME acceptance. The window-activation log reports native visibility only, not
the webpage's visibility state or proof that Safari was tested.

The macOS runtime manages the separate WebKit store outside the repository.
Preserve it while collecting evidence. Do not indiscriminately clear WebKit
data or remove unrelated profiles. Generated app/downloads/logs are under
`tmp/native-qa/`; source stays under `tools/native-qa/`.

The background-image helper is intentionally pinned to the historical image-visibility candidate and will reject later application changes. Its previous native visibility result is historical helper-level evidence. Current preview cleanup and normal Safari evidence: `${VDOC_QA_EVIDENCE:-qa-evidence}/preview-failure-cleanup-20261011/audit.json`.
