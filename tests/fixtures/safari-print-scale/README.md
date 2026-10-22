# Safari native print-scale isolation

Native print-dialog checks executed on 2026-10-10 in Safari 26.6.2 / macOS 26.6.2 (25G83). **No new PDF was saved; these counts do not close native PDF acceptance.**

Settings: A4 portrait, Print backgrounds enabled, Safari headers/footers disabled. Each comparison changed only scaling. These files contain no user document data, network requests, storage access, or Paged.js runtime.

| Fixture | 100% pages | 101% pages | Control |
| --- | --- | --- | --- |
| full-sheet.html | 2 | 6 | Production print CSS |
| intrinsic-height-control.html | 2 | 4 | Auto sheet/page height |
| root-auto-control.html | Not run | Not run | Auto root width |
| all-auto-control.html | 2 | 4 | Auto heights and outer widths |
| auto-paper-fixed-control.html | 4 | 6 | Fixed containers, auto paper size |
| auto-paper-control.html | 2 | 4 | Auto heights, widths and paper size |
| plain-control.html | 2 | 4 | Two short blocks, explicit page break, no production CSS |
| single-page-control.html | 1 | 2 | One heading and paragraph, no CSS at all |

The single-page result repeated in regular and Private Safari. The first full-sheet 100% attempt with Safari headers/footers enabled showed four pages; switching that option off gave two. Do not mix that initial count with the controlled matrix above.

The 101% extra-page symptom therefore also occurs outside VDoc's editor, tables and pagination code on this machine. This narrows investigation; it does **not** prove the exact Safari/environment cause, that every added page is blank, or that VDoc has no independent print problems. None of the CSS variants solved the symptom, so none was applied to production.

Native Save PDF panels displayed a disabled Save button despite selecting a filename and destination. No new saved artifact was obtained. A minimal no-filter file input also had a disabled Upload button; the application file-extension filter is not established as the cause. System input controls and tool interaction remain possible factors, not confirmed diagnoses.

## Evidence and reproduction

[native-observations-20261010.json](native-observations-20261010.json) binds each observed count to the SHA-256 of the actual HTML, plus the unchanged production print source hash. Null page counts mean not run. Source-hash labels copied into derived fixtures identify their baseline; only full-sheet uses the unchanged production rules. In particular, plain-control does not contain production print CSS.

Serve the files through the local development server, open each in Safari and invoke Print. Record the counts at 100% and 101% with the settings above. To verify output integrity, save distinct PDFs and inspect all text markers, clipping and duplicate content. Counts alone are insufficient.

The existing command below regenerates **only the original two fixtures** (full-sheet and intrinsic-height-control) and their original manifest; additional controls above are retained diagnostic snapshots. Compare hashes before reusing observations after regeneration or any source change.

```sh
node --experimental-strip-types scripts/create-print-scale-repro.mjs
```

After any successful reduced-case fix, repeat the unedited [original QA source](../safari-preview/source.vdoc.json), including all 36 rows, image, headers/footers and final-page text. Do not infer the original document's output from these short controls.
