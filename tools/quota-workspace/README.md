# Isolated native quota acceptance workspace

Run `npx vite --config tools/quota-workspace/vite.config.mjs` and open `http://127.0.0.1:4176/tools/quota-workspace/index.html`. This is a local QA entry, excluded from the normal application entry and production build.

The browser must support Storage Buckets and read back the requested 8 MiB quota. Each UUID bucket is independent. Vite selects that real native IndexedDB factory for the unchanged document-store operations. A test-only observer adds native transaction complete/abort listeners without overriding errors or commit behavior. It does not test physical disk exhaustion or Safari.

Before filling: create and export a QA baseline, restore it in a separate bucket, record its content and available space, and save a control document/version. Expand the QA controls. Fill stops at its first native rejection or its 32 MiB budget. The event report includes batch keys and usage. Save edits through the ordinary editor and capture visible failures plus native transaction records. Export failed drafts using the product backup button and compare full structures after clean import.

Release QA filler before reloading, HMR edits or closing the page: registered keys are held in memory. This only deletes this page's filler keys, never documents/versions. Download the QA event report and database snapshot before cleanup. Do not clear personal browser storage. Retain bucket IDs and fixtures in tests/fixtures/quota-bucket-20261010/audit.json. The initial standalone capability probe on 4175 still needs its own cleanup.

References: https://developer.chrome.com/docs/web-platform/storage-buckets and https://github.com/WICG/storage-buckets/blob/main/explainer.md

## Independent browser runner

When the in-app controller is unavailable, an installed Playwright runtime can launch the installed Chrome executable with a fresh temporary profile. Never attach to a personal browser or reuse its user-data directory. The audited drivers are retained under `tmp/quota-browser/` and their real downloads/events under `tests/fixtures/quota-retest-20261010/`. Run only one browser flow at a time, then close it before full tests/builds. Chrome 154 native Storage Buckets passed the 8 MiB bounded refusal probe. This is not Safari or OS IME evidence.

The first workflow attempt used an overly early control timestamp; normal return-home save changed that timestamp before the fill. Compare the pre-fill database snapshot instead. The second attempt completed all product assertions but timed out on a report button hidden after reload. The driver now opens QA controls before report download and awaits click/event together so failures are handled and the browser closes. Preserve both attempts alongside subsequent clean runs.
