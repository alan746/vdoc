# Image storage design benchmark

Run from this directory:

```sh
python3 -m http.server 8769 --bind 127.0.0.1
```

Open `http://127.0.0.1:8769/?mode=inline`, press **Run benchmark**, and copy the
result JSON. Follow **Content-addressed blobs** (a full page navigation) and run
again. Keep other tabs on this origin idle. Only run one benchmark at a time.
Both modes create and remove their own `vdoc-image-benchmark-*` databases. No
production document database is accessed. If a run is interrupted, rerunning the
same mode removes its previous scratch database. Close other benchmark tabs if
an IndexedDB delete is blocked.

This compares one document and ten versions containing ten seeded PNG images,
with five warm-up writes and thirty measured writes. Both modes use strict write
durability. The candidate hashes images once and stores their binary blobs before
writing references. The report separates preparation, enqueue, completed write,
storage estimates and coarse heap samples after loading all versions.

`results-2026-10-17.json` is the measured summary (timings rounded to 0.1 ms).
For methodology, limitations, decision, and the future production design, see
[the design](../../docs/design/IMAGE_BLOB_STORAGE.md). This page is an isolated
prototype, not a migration tool or a production storage adapter.
