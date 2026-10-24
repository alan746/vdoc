## 2026-10-12: reader ordering control remains experimental

Chrome 155 PDFium enables `auto_order` in `CloseTempLine`; an independent Chrome for Testing check fixes the older Hebrew reference. A reader upgrade alone does not repair existing product output. Sorting marked-box prototype tokens by DOM left coordinate preserves pixels in all seven PDFs and leaves source content and cancellation intact. Whole-text extraction passes 5/7 in Chrome 155, 4/7 in PDF.js 6.5.128, and 4/7 jointly: Hindi, plain Arabic, plain Hebrew, and Arabic numbers. Both diacritic cases still fail, and PDF.js misorders one Hebrew-number case. This is not product acceptance or proof of partial-selection/search correctness. Combining-character association and numeric RTL order remain investigation areas. Evidence: `${VDOC_QA_EVIDENCE:-qa-evidence}/pdf-chrome155-20261012/audit.json`. Product candidate `fd601855` is unchanged; G3/G4/G5/G7 remain open.

## 2026-10-12: bundled LibreOffice independent controls rejected

Bundled LibreOfficeDev26.8.0.0.alpha0 converts owned four-line FODT sources with disposable profiles. Initial default-font substitution and a second explicit Noto-font/fontconfig group both fail the combined reader requirement: only Hebrew PDF.js full copy passes. All six rendered pages were inspected. The corrected group verifies embedded Noto font identities, eliminating the initial fallback/style ambiguity. No installed app, product dependency or exporter change; conversion profiles and isolated readers were closed. Evidence: `${VDOC_QA_EVIDENCE:-qa-evidence}/pdf-libreoffice-20261012/audit.json` and `explicit-fonts/audit.json`. Do not repeat these configurations or infer all LibreOffice versions/configurations are incapable.

Current product core regression G6 passed on76258d84:2033cases covered via2029full-run passes plus4loopback-permission retests. Full-run exit1 remains archived, not rewritten as green. Actual rebuilt production editing/backup/PDF-button flows pass. G3 remains open independently.

## 2026-10-12: local fixed-PDF native scaling passes; further text controls rejected

The local product path now includes dev and production launchers. Real production UI download followed by native Safari 93/99/100/101/102% saves passes the five-page layout gate; see `${VDOC_QA_EVIDENCE:-qa-evidence}/local-pdf-production-20261012/audit.json`. This does not close text copy.

Noto unicode-range fallback on the same paginated snapshot fails both stock readers. ReportLab4.4.9 initially ignored `drawString(shaping=True)` because rlbidi was missing: the successful full-copy control was unshaped. Explicit `shapeStr(force=True)` with glyph assertions gives visible shaped runs, but Indic/Arabic selections contain PUA characters and Hebrew Chrome word order is wrong; only Hebrew PDF.js full copy passes. Reject these controls; do not call the initial pass shaped acceptance. Official rlbidi wheel requires authentication; no credentials or access workaround used. HarfBuzz is tmp-only. Three explicit shaped renders and five Noto pages were viewed. See `local-pdf-fontmap-20261012/audit.json` and `pdf-reportlab-20261012/audit.json`. Product remains candidate76258d84 and G3 open.

## 2026-10-12: explicit negative text advance remains a rejected Hebrew control

A renamed derived TrueType font reflects each glyph within its advance; the text matrix reflects it back while advancing right-to-left. Shaping and Unicode maps still use the original font. The single plain Hebrew page was rendered and viewed, but stock Chrome returned reversed word order and the official PDF.js copy handler returned reversed character order. Neither reader is patched, and the result is rejected. Do not extend it to production or claim all negative matrices fail.

The initial font transform failed before PDF creation because bundled Python lacked fontTools. It was installed only under the existing temporary QA dependency directory; source and derived fonts plus the OFL are retained. Evidence: `${VDOC_QA_EVIDENCE:-qa-evidence}/pdf-rtl-matrix-20261012/audit.json`. No product PDF change. The independent application change this turn only extends existing composition guards to external operations and history; its acceptance is separate.

## 2026-10-12: distinguish DOM selection from the official PDF.js copy handler

`check-pdfjs-browser.cjs` now records both the original `matchCollapsed` (raw DOM selection) and `copyMatchCollapsed` (the unmodified official PDF.js copy handler). Output names end in `-copy-handler`; previous evidence and screenshots remain unchanged. The event is synthetic and writes only to an in-memory `DataTransfer`, never the system clipboard. This is not native Ctrl-C/Paste or assistive technology acceptance. The [official handler](https://github.com/mozilla/pdf.js/blob/master/web/text_layer_builder.js) normalizes selected Unicode, whereas the visual text layer disables normalization.

The retained marked-boxes seven-file baseline still passes only Hindi after the correction. Six RTL cases still fail. Three existing full-document direct-export candidates (4, 4, and 5 pages) were also read in stock Chrome and official PDF.js: all six body comparisons fail even after separating counted generated page headers/footers from body text. The corrected handler removes the Latin ligature false mismatch but retains real Hindi word-internal spaces and RTL errors. This rules out promoting these three existing artifacts as-is; it does not prove all generators or fonts fail.

Evidence: `${VDOC_QA_EVIDENCE:-qa-evidence}/pdf-direct-readers-20261012/audit.json`; its `analyze.py` checks immutable source PDF hashes, repeatable raw selections, copy-handler execution on all thirteen pages, margins, and the preserved negative controls. No PDFs or product code were authored. Current product candidate remains 99d783b5, and I/P/S/F remain open. Stop treating raw text-layer differences alone as copy failures; do not delete spaces, reorder text, or normalize comparison strings to manufacture a pass.

A bounded native PyMuPDF Story 1.28.2 reference also failed all six stock-reader copy comparisons for three plain Hebrew/Arabic/Hindi files. All fonts were embedded with ToUnicode and the three renders were viewed. Package SHA-256 matches PyPI; it remains QA-only under tmp, not a product dependency. Do not generalize to every configuration or call this a browser interface. Evidence: `${VDOC_QA_EVIDENCE:-qa-evidence}/pdf-story-20261012/audit.json`. Official [Story API](https://pymupdf.readthedocs.io/en/latest/story-class.html) and [AGPL/commercial licensing](https://pymupdf.readthedocs.io/en/latest/about.html#license-and-copyright) remain integration considerations, not procurement decisions.


## 2026-10-12: ReversedChars control does not close cross-reader selection

Two bounded controls wrap the existing source-order and page-order Hebrew Type0 lines in standard `/ReversedChars` marked content. Canonical drawing-operator serialization and 900px raster comparisons remain equal to the respective baselines. Both PDFs were viewed. Chrome selects all 22 tested words correctly, but full text still passes only the source-order file; official PDF.js text-layer selection passes only the page-order file. Neither satisfies the combined requirement, so neither is integrated. This is a negative control, not a standards-conformance certification or proof that every generator must fail.

The numeric-operand assertion in the QA writer initially compared in-memory floats to serialized/reparsed values; that comparison failed twice before being corrected to canonical operator serialization. Initial output and failure details remain in evidence. The readers were not modified. Evidence: `${VDOC_QA_EVIDENCE:-qa-evidence}/pdf-reversed-chars-20261011/audit.json`.

The [PDF Association discussion](https://github.com/pdf-association/pdf-issues/issues/718) supplied the standard-marker hypothesis and documents interoperability concerns; it is a discussion, not a normative requirement or a waiver of VDoc acceptance. No additional character-order/spatial workaround is selected from this result.

# Local PDF export investigation (not a shipped feature)

## 2026-10-11: Type0 controls and browser Typst feasibility remain negative

`pdf-type0-minimal-20261011/audit.json` binds four real embedded TrueType controls and three browser-WASM Typst outputs. Type0 source-word order passes Chrome only; page-position order passes PDF.js only; logical order and local ActualText fail. All four rasters match, 30/44 word probes pass, and six regressions protect these failures. The Arabic dot/base cluster guard stops the intentionally minimal encoder before writing a PDF.

Typst web compiler 0.7.0 is downloaded only under tmp, registry-integrity checked, and used with a dummy filesystem/local fonts in an isolated browser. Three PDFs compile successfully but all fail full selection in both readers; four artifact regressions pass. No production dependency is added. No general engine verdict: compiler warnings were not separately archived and no full layout adapter, native reprint or fine selection suite was performed. Initial import-hook and local runtime issues are retained. Stop expanding failed stream permutations; PDF gate remains open while independent native IME evidence is pursued.

## 2026-10-11: reject token-boundary and whitespace mapping controls

Three new QA-only modes (`VDOC_QA_RECORD_TOKEN_BOUNDARY`, `VDOC_QA_RECORD_SPACE_MAP`, `VDOC_QA_RECORD_LEADING_SPACE`) are negative controls, not successors to record-marked-boxes. Separate token text objects fail both readers; a whitespace-first mapping loses letters; a whitespace suffix restores one Hebrew PDF.js sample but regresses Chrome full text and three word probes. Stop expanding the last mode after that single counterexample.

`${VDOC_QA_EVIDENCE:-qa-evidence}/pdf-token-boundary-20261011/audit.json` binds 15 PDFs/identical rasters, 11 Chrome full/88 word selections, 15 PDF.js actual text-layer selections, executed source snapshots, and six artifact regressions (`test-token-boundaries.py`). No product source, dependency or acceptance status changes. Full partial selection, search, guards/download and native print were not rerun for rejected variants. Next establish standard embedded-font source mapping with a minimal unmarked RTL case before more Type3 spatial work.

## 2026-10-11: reject source-order atomic marked graphemes

`record-grapheme` is a negative QA control, **not the retained candidate**. It uses one semantic record per marked RTL grapheme in source order and paints the original shaped ink independently. Actual Chrome full selection passes only 3/5 documents; word selection passes 31/40. Arabic جَمِيلَةٌ becomes جَمِليَةٌ and Hebrew שָׁלוֹם becomes שָׁולֹם. Stop further pointer/search expansion on this mode. Stable baseline remains `record-marked-boxes`.

Seven PDFs/renders, five Chrome full/40 word selections, seven official PDF.js DOM selections and six standalone PDFium word-index inspections are bound in `grapheme-audit.json`. Visible path/position preservation does not imply Unicode correctness; five rasters match and two marked rasters differ locally. PDF.js still fails all six RTL samples. Standalone PDFium153 tight/loose bounds and zero-tolerance index probes are diagnostic only, not Chrome154 pointer/caret acceptance. Missing expected words receive no guessed offsets.

Run `python3 tools/pdf-export/test-grapheme-indices.py` with the PDF/Pillow runtime: seven artifact regressions plus eleven retained boundary controls pass. Do not use unittest discovery with these hyphenated filenames: the initial zero-test attempt was rejected and its log is retained. No production files, dependencies or formal export entry changed. I/P/S/F remain unsigned; product acceptance gain is zero. Full guard/download, numeric Chrome and native print were not rerun for this rejected mode.

## 2026-10-11: reject advance/space-box variants; separate focus artifacts

Stable candidate remains **record-marked-boxes**, not either new experiment. `record-mark-advance` gives marked grapheme records positive advances/explicit text positions, but a previously passing Arabic لَ selection becomes ل even after focus control. Its local gains do not justify promotion. `record-space-bounds` supplies full DOM rectangles for whitespace: it retains pixels/full copy yet regresses 14 word tails (282/318 vs296/318). Neither fixes actual PDF.js text ordering.

`boundary-controls-audit.json` binds 14 PDFs/renders, 12 Chrome full/96 word selections, 14 actual PDF.js DOM selections, 1286 actual drags including initial focus failures and 52 focused controls, five search pairs, 11 new artifact tests and ten retained tests. No product acceptance gained. Keep the initial five empty-B failures; 34 first-character controls pass after explicit focus, while the Arabic regression persists. Do not substitute controls for a complete candidate suite.

The wide source-coordinate reader now always focuses its isolated page, clicks blank PDF space and waits500ms before the first drag. `VDOC_QA_EVIDENCE_TAG=focused` adds a distinct full-suite evidence suffix; `focused-controls` restricts to B and named regression targets and must never be presented as a full suite. Source captures and output screenshots carry the same suffix. Historical reports are untouched. No personal browser or clipboard use. Both rejected encodings have dedicated opt-in generation flags `VDOC_QA_RECORD_MARK_ADVANCE` and `VDOC_QA_RECORD_SPACE_BOUNDS`; they are QA negative controls, not features.

Next investigate semantic indices/mark attachment and cross-reader word separation while retaining the stable marked-boxes baseline and all prior guards. Production integration and I/P/S/F remain open.

## 2026-10-11: scoped marked-word boxes retain 23 edge improvements

Current QA candidate is `browser-record-marked-boxes-prototype.js`, selected by `VDOC_QA_RECORD_MARKED_BOXES=1`; reader variant `record-marked-boxes`. It extends DOM-measured grapheme slots only inside marked Arabic/Hebrew words and keeps natural ink bounds for unmarked final graphemes. Existing numeric LTR/terminal-digit, Arabic alef/lam and Hindi behavior remains.

`marked-boxes-audit.json` binds eight PDFs/renders, seven Chrome full selections, 56 word probes, 916 partial drags, seven actual PDF.js DOM selections, five search pairs, seven error/cancellation guards and one real download hash check. Ten new artifact regressions and fourteen retained ones pass. Base edge 273→296/318 (23 fixed, zero regressions), interior262→263/318 (one fixed, zero regressions); extra numeric edge137/140 and interior140/140 unchanged. Never merge protocols: 22 base edge, 55 base interior and three numeric edge failures remain.

Actual PDF.js still passes only Hindi strict full selection (1/7). The local negative-advance whitespace reset is recorded as a hypothesis, not a fix. No reader modification or product promotion. All base visible vector paths/transforms are preserved within 0.0001 PDF units; five of seven rasters are identical and both marked-page differences were reviewed. Downloaded safety raster equals its reviewed sample. Next: remaining marks/word tails and cross-reader separation/order, then production multi-page/style/image/font export and native reprint. I/P/S/F and AI remain unsigned.

## 2026-10-11: decimal direction, terminal selection, and real PDF.js text layers

Current QA candidate: `browser-record-number-tail-prototype.js` (`VDOC_QA_RECORD_NUMBER_TAIL=1`; reader variant `record-number-tail`). `VDOC_QA_NUMBER_CASES=1` adds two fixed Arabic/Hebrew number fixtures. Pure decimal tokens explicitly shape LTR; only the terminal digit gets an independent semantic box. This is a bounded single-page research candidate, **not the production exporter**.

`numeric-reader-audit.json` in `${VDOC_QA_EVIDENCE:-qa-evidence}/reader-control-20261011` binds 21 PDFs/renders, 19 Chrome full selections, 152 word selections, 2112 partial drags, 14 official PDF.js browser text-layer selections, ten search-control pairs, 14 new artifact tests and 13 retained tests. Final seven full selections and 56 words pass in Chrome. Final base edge/interior totals: 273/318 and 262/318; extra numeric totals: 137/140 and 140/140. No previous pass regresses in any of these four comparisons. Do not combine offsets or count negative-control test passes as product acceptance.

Arabic-Indic glyph direction was wrong even when full text copied correctly. Fixed LTR shaping plus terminal geometry passes all ten Arabic-Indic pointer targets at both offsets. Character boxes alone are insufficient: the rejected all-digit-box representation can place them correctly while leaving reversed visible ink and failed selection. Numeric scope is Latin digits and U+0660–U+0669 in the owned fixtures; not all decimal scripts/fonts.

`check-pdfjs-browser.cjs` renders official PDFPageView canvas/text layers and selects the actual DOM layer. It is neither raw `getTextContent` concatenation nor Ctrl-C/clipboard/assistive technology acceptance. Final strict full-text results: Hindi passes, all six RTL samples fail boundaries/marks. `record-flow` is a negative control: visual token order fixes ordinary RTL in PDF.js but breaks Chrome full-copy word order. `record-digits` is also rejected due to a Hebrew first-digit regression. Do not promote either.

Final base visible vector paths/transforms stay within 0.0001 PDF units of record-alef; only 3/7 final rasters are identical. Numeric Arabic direction intentionally changes. `test-numeric-reader.py` protects real artifacts and these explicit negative controls. No new candidate safety/download suite was run this round; retained earlier tests validate historical evidence. Next: marked RTL and word boundaries in both reader engines, then real VDoc export integration and native print acceptance. Product fingerprint and gate states unchanged.

## 2026-10-11: targeted Arabic hit boxes improve 17 retained edge probes

Latest audit: `${VDOC_QA_EVIDENCE:-qa-evidence}/reader-control-20261011/rtl-hitboxes-audit.json`: 17 new PDFs/renders, 15 actual full copies, 120 word selections, 1908 partial drags, ten positive/absent search pairs, fourteen guard checks and two actual download hashes. Thirteen new artifact regressions and twelve previous regressions pass. Product and gate status unchanged.

`VDOC_QA_RECORD_ALEF=1` selects `browser-record-alef-prototype.js`; reader tools use `VDOC_QA_READER_VARIANT=record-alef`. It changes only alef/lam in unmarked Arabic words: measured semantic rectangles are independent of separately painted, identical vector glyphs. Other codepoints retain record-actual. This is a narrowly observed QA representation, not a general Arabic/RTL font strategy or production exporter.

The retained 0.15px near-edge corpus improves 255→272/318: Hindi50/50, Arabic78/82, Hebrew61/61, marked Arabic50/74, marked Hebrew33/51. Seventeen improvements and zero new failures are checked case by case. Do not hide the remaining 46 failures. `VDOC_QA_DRAG_INSET=1` writes distinct `-inset1` artifacts, capping inset at one quarter range width; old256→new262/318, six improvements and no new failures. Never combine the two protocols' successes or replace existing edge evidence.

Five final full copies, forty word probes and five searches pass; PDF.js Hindi strict text equality remains. RTL PDF.js/pypdf compatibility is unresolved. `inspect-ink-geometry.py` proves identical visible glyph path multisets and transforms within0.0001 PDF units; it is not a pixel or layout signoff. Final Hindi and Hebrew renders match pixels, two Arabic renders do not. The differences and viewed crops are retained. The seven guard checks for record-actual Hindi and record-alef Arabic and both actual downloads pass. Unsupported styles, fonts and layouts remain QA limitations.

Rejected controls: `VDOC_QA_RECORD_RTL=1` preserves records but annotates RTL clusters; marked full copies regress. `VDOC_QA_RECORD_BOXES=1` applies separate hit boxes broadly; some near-edge passes regress. All results remain auditable. A test initially asserted that broad-box regression in the wrong (1px) comparison; it was corrected to the recorded0.15px comparison, with the first failed test log retained. No raw reader evidence changed.

Next: retain both baselines and isolate marked-character caret direction, digits and word-end boundaries. Official Chromium main source (`pdf/pdfium/pdfium_engine.cc`, GetCharIndexBasedOnPointData) suggests individual-character direction is relevant; this is not the exact installed build or proof that every failure is upstream. Production adapter/fonts/styles/images/pages/native reprint/historical-source/IME evidence and joint signoff remain open. No AI integration.


## 2026-10-11: local codepoint annotations improve Hindi selection without parser regression

Latest audit: `${VDOC_QA_EVIDENCE:-qa-evidence}/reader-control-20261011/cluster-annotations-audit.json`. Twenty new PDFs/renders, twenty actual full-copy cases, 160 word probes, 648 valid partial-drag cases across candidates/controls, ten positive/absent search pairs; twelve new regressions and twelve retained regressions pass. Product sources, dependencies and gates are unchanged.

Prefer the **QA-only** `browser-record-actual-prototype.js` for the next experiment. `VDOC_QA_RECORD_ACTUAL=1` retains the bidi-run single-codepoint records and wraps only non-RTL multi-codepoint shaped clusters in local ActualText. This keeps five Chrome full copies, 40 word probes, five searches, Hindi PDF.js strict whitespace-collapsed text equality, and all five rendered pages' pixels. It is not a general font strategy or production exporter.

Set `VDOC_QA_READER_VARIANT=record-actual` for the reader/search/partial/extractor tools. `VDOC_QA_STABLE_DRAG=1` explicitly refocuses and settles the PDF viewer before dragging. `VDOC_QA_WIDE_DRAG=1` expands the drag corpus to body and table words. Current source reconstruction matches standards mode, every token width and five original source screenshots exactly. The corrected wide run is 255/318: Hindi50/50, unmarked Hebrew61/61, Arabic63/82, marked Arabic48/74, marked Hebrew33/51. Retain failures, including digits/ligatures/marks; do not generalize full-word success to partial selection.

The initial wide run reconstructed a quirks-mode page, giving tables16px instead of22px. Its table probes are invalid and retained separately. Initial pre-focus whole-cluster drag data had two English first-letter misses; stable repeats are the applicable comparisons. Native-control reconstruction deliberately keeps its original quirks mode and does not certify the product. `inspect-cluster-geometry.py` uses a separate PDFium153 build, not the Chrome154 UI engine; it shows zero-width codepoint continuations, overlapping whole-cluster boxes, and local-annotation split boxes.

Rejected/new controls: `VDOC_QA_WHOLE_CLUSTER=1` preserves raw clusters but fails partial Hindi and marked RTL copy. `VDOC_QA_CLUSTER_ACTUAL=1` annotates all scripts' clusters and regresses marked RTL copy. `VDOC_QA_LOCAL_CLUSTERS=1` improves Chrome Hindi dragging with whole-cluster ToUnicode but regresses PDF.js Hindi spacing. The record-actual variant avoids that additional parser regression. RTL extraction remains unresolved in PDF.js/pypdf. Generator encoding modes are now mutually exclusive; extraction writers also refuse overwriting evidence.

Next: isolate Arabic ligature and marked RTL/digit hit geometry while retaining this entire observed corpus. The actual app adapter, supported fonts/styles, images/multiple pages, formal export button, native Safari reprint, historical-source/IME evidence and joint signoff remain open. No AI integration.


## 2026-10-11: marked whole-word copy passes; partial selection still fails

Latest audit: `${VDOC_QA_EVIDENCE:-qa-evidence}/reader-control-20261011/bidi-runs-audit.json`. Ten new PDFs/renders (five bidi-run prototypes, five rejected width controls), ten real Chrome full copies, 80 word probes, 110 grapheme-range drags, five positive/absent search pairs, and twelve artifact regressions. Nothing is integrated into the product.

`VDOC_QA_BIDI_RUNS=1` selects `browser-bidi-runs-prototype.js`. Five samples now pass actual Chrome full-text equality with whitespace collapsed and 40 word probes, including marked Arabic/Hebrew and 123. This encoding handles contiguous RTL letter runs separately from marks while placing visible outlines at shaped positions. It is an empirical Type3 experiment, not a general bidi algorithm or approved font strategy. No ActualText replacement is used. Four of five reference renders are pixel-identical; unmarked Hebrew has a retained localized difference.

`check-search-bidi-runs.cjs` uses the actual plugin text-fragment API with positive/absent controls, not Cmd-F UI. Five visible first-word highlights fit independently measured source rectangles. `audit-search-bidi-runs.py` excludes asynchronous toolbar/thumbnail pixels using page geometry; no negative highlight remains. Three negative images have 1/255 gray differences in one or two pixels, retained explicitly. Raw top-level search method had a stale double-click label; per-result method was correct and current tool metadata is corrected. Earlier whole-window pixel analysis is retained as invalid, not acceptance.

`check-partial-bidi-runs.cjs` reconstructs the exact source/font and requires original eight word rectangles within 0.05 px before using Intl.Segmenter/DOM Range to drive real pointer drags. 48/55 pass; all 35 Latin controls pass but seven complex ranges fail (e.g. हि → ह). **Do not ship on whole-word success.** `VDOC_QA_CLUSTER_WIDTH=1` selects a separate rejected experiment distributing advance across cluster records. All five rendered pages retain pixels, but marked RTL full copy regresses and partial selection is not repaired (44/55); retain this negative control, do not promote it.

PDF.js strict whitespace-collapsed equality passes only Hindi. Simple RTL removes word separators even though deleting whitespace masks the defect; marked RTL also reorders marks. pypdf disagreement remains. Twelve passing tests in `test-bidi-runs.py` include failure detection and are not product signoffs. Use exactly one generator diagnostic flag; writers refuse overwrite. Run named reader/partial scripts for new artifact names only. Evidence binds PDFs, source reports, rendered pages, snapshots and hashes.

Next: correct grapheme hit geometry and cross-reader semantics before font fallback, styled/multipage VDoc layout, formal export UI, native Safari reprint and final joint signoff. Do not repeat the rejected equal-width, whole-line ActualText or source-codepoint-only approaches without a new hypothesis.


## 2026-10-11: source-token order preserves simple-script copy and word hits

Latest evidence: `${VDOC_QA_EVIDENCE:-qa-evidence}/reader-control-20261011/audit.json` — 15 new single-page PDFs/renders, 15 actual Chrome full-copy checks, 120 word-selection probes, and eight artifact regression tests. The product, dependencies, candidate fingerprint and gate statuses are unchanged.

`browser-sourcewords-prototype.js` keeps source token order, keeps HarfBuzz's visual glyph order within each token, and places the tokens through one positioned TJ line. In actual Chrome, Hindi, unmarked Arabic and unmarked Hebrew now each pass full-copy equality with whitespace collapsed and all eight word probes. No whole-line ActualText replacement is used. This is an experimental Type3 semantic-record representation, not approved font embedding or general document export.

Marked Arabic/Hebrew still fail full copy and five of eight word probes each. Digits 123 survive in those actual-reader observations. pypdf still reverses the simple RTL source-token representation, and PDF.js marked Arabic still fails. Actual reader results, parser results, selection geometry and pixels must remain separate observations. Three source-token PDFs are pixel-identical to their prior references; two Hebrew variants have small localized pixel differences, retained in the report.

The five `reader-control.cjs` outputs use Chrome's own print renderer on contiguous source paragraphs with the same fonts. All five fail exact full-copy checks in this installed reader; unmarked Hebrew still passes all eight word probes. This is a bounded control, not proof that all native PDFs fail. The separate `browser-logical-prototype.js` codepoint-position variant also fails and is a retained negative control.

`check-reader-control.cjs`, `check-reader-logical.cjs` and `check-reader-sourcewords.cjs` use isolated Chrome and temporary fixed-allowlist loopback servers. Double-click centers come from DOM Range measurements in the same-source/font control; word checks allow exclusion of terminal period/danda only. Source equality is verified before reusing coordinates. Native viewer geometry includes the scroller offset. No user browser or system clipboard is read.

Generation uses `VDOC_QA_SOURCEWORDS=1 node tools/pdf-export/run-browser-unicode.cjs words unicode` (or arabic/hebrew; add `VDOC_QA_MARKED=1` for marked RTL). `VDOC_QA_LOGICAL=1` creates the rejected logical-codepoint control. Choose one diagnostic flag at a time; do not combine historical modes. Writers refuse existing PDF/result names. `test-reader-mapping.py` verifies retained actual artifacts; its eight passing tests include correct failure detection and do not promote acceptance rows.

Next: extend the working simple-script source-token representation to combining-mark/glyph clusters without breaking hit geometry; verify character-level selection, search, other actual readers and font choices. Real VDoc pagination, styles/images/multiple pages, Safari reprint and formal UI integration are still pending. Do not repeat whole-line ActualText or logical-codepoint-only variants as if they were untested.

## 2026-10-11: real reader selection rejects whole-line ActualText

Latest evidence: `${VDOC_QA_EVIDENCE:-qa-evidence}/pdfkit-browser-20261011/audit.json`: 25 new one-page PDFs/renders, 37 actual Chrome full-selection cases, 12 valid double-click word selections across six files, and nine artifact regressions. These are QA evidence, not product gate closure. Product dependencies and the candidate fingerprint are unchanged.

`check-chrome-selection.cjs` serves a fixed allowlist of owned PDFs on a temporary loopback port, launches an isolated headless Chrome, waits for the real PDF viewer to load, then obtains PDFium's selection through the viewer's internal controller. It never reads the system clipboard or a user's browser. The internal API is a version-specific QA technique, not a shipping API. Every result is bound to the PDF hash; browser and server close in `finally`.

The real reader exposed failures hidden by parser-only checks. Baseline Hindi copies correctly even where PDF.js inserts internal word spaces; basic Arabic/Hebrew copy with reversed word order despite passing simple pypdf/PDF.js checks. PDFKit 0.20.2's full-run browser API also fails this corpus: Indic/Arabic mappings, RTL word order, and marked RTL digits visibly and semantically changing from 123 to 321. `compare-pdfkit.cjs` is QA-only; its cached mode was not tested.

Whole-line ActualText preserves drawing operators and every pixel and yields correct full-copy text for five samples. **It is rejected:** double-clicking the same visible words that pass in the original returns a different word or nothing in all six annotated checks. `check-chrome-word-selection.cjs` includes the actual viewer scroller offset; the first attempt omitted that offset and is explicitly invalid, retained separately. Whole-copy success does not establish hit geometry, selection, or search correctness.

Smaller word annotations, one TJ array, and one continuous string remain RTL negative controls. The string mode intentionally omits inter-token positioning corrections; its pixel differences are recorded, not approved. The Type3 zero-advance semantic decomposition remains experimental. Do not integrate any of these variants into the product.

Reproduction flags for new, nonexisting output names:

- `VDOC_QA_ACTUAL_TEXT=1 node tools/pdf-export/run-browser-unicode.cjs arabic unicode`: rejected whole-block annotation.
- `VDOC_QA_ACTUAL_TEXT=word|line|string`: separate rejected word/TJ/string experiments; choose one value, not the literal pipe list.
- `VDOC_QA_MARKED=1`: marked Arabic/Hebrew and numeric source samples.
- `VDOC_CHROME_SELECTION_SET=legacy|actualtext|actualtext-word|single-tj|single-string`: choose one recorded reader corpus; unset uses the initial 11-case set.
- `test-reader-selection.py` checks the retained real PDFs and reader evidence without opening a browser. Nine passing tests include correct rejection of bad artifacts.

All artifact writers refuse existing PDF/reader-result names. Prior evidence is retained. Snapshot files in the latest evidence directory bind the tools used at closeout; the final mixed-size-line/unknown-mode guard additions have not been exercised as separate browser cases.

Next work must preserve both logical Unicode order and glyph hit geometry, with paragraph bidi/shaping and source-position mapping. Screen candidate representations against these failures before a VDoc layout adapter, mixed fonts/styles, images, multiple pages or a formal export button. Local word selection, search and native Safari behavior must be verified independently; historical source A, native IME visibility and joint sign-off remain open.

## 2026-10-11: Unicode-record experiment — still QA only

Latest evidence: `${VDOC_QA_EVIDENCE:-qa-evidence}/browser-unicode-20261011/audit.json` (21 PDFs/21 renders; 8 real-artifact regression checks). `browser-unicode-prototype.js` decomposes each shaped cluster into single-codepoint records: the first non-mark record carries its visible outline and advance; other records have empty outlines and zero advance. This is explicitly a semantic-encoding experiment, not approved font embedding or character selection, and has no production import.

Basic Hindi, Arabic and Hebrew main paragraphs now preserve word order and spaces in both readers; PDF.js full simple-fixture text matches with consecutive whitespace collapsed. Hindi pixels are unchanged. Actual download SHA-256, cancellation, missing glyphs, overflow, font mismatch and an added wrapped-block refusal are verified. Do not draw wrapped blocks as a single line.

Complex cases remain negative: Arabic diacritics attach to wrong positions in PDF.js; pypdf drops the visible `123` in mixed RTL samples, and merges adjacent table-cell text. Rendering alone cannot approve these files. Three Hebrew simple-line variants also differ locally at the pixel level, recorded in `pixels.json`. Native Safari reprint, real selection, full font coverage, actual document layout and formal integration are not tested by this experiment.

Use `run-browser-unicode.cjs words unicode` (or arabic/hebrew); `VDOC_QA_SAFETY=1` exercises refusal/download paths. Existing PDF names refuse overwrite. `verify-browser-unicode.mjs` and `test-browser-unicode.py` inspect retained artifacts; passing those tests includes correctly detecting failed PDFs. Dependencies/fonts remain the previous QA-only local assets. No application code or dependencies changed.

## 2026-10-11: early fonts and contextual long-document limit

`VDOC_QA_FONT_PHASE=before-pagination` registers separate diagnostic font aliases before the preview renders, then asserts loaded fonts, the render handshake, and the first-page timestamp. It compares every paragraph/table/image box and computed typography between preview and print copy. It is deliberately limited to Arial fixtures and rejects other explicit font choices/code blocks; the global diagnostic style is not a user-font policy. Default `after-pagination` remains the previous diagnostic.

The first `b-early` run is **invalid evidence of early fonts**: the iframe initialized as about:blank and skipped a pathname guard. Missing timing evidence now fails before PDF creation. Observers/fonts are reattached to the actual document at the render handshake. Replacing the whole Arial family was also rejected as a strategy after other scripts changed fallback; separate aliases avoid that family replacement.

The long fixture exercises different Hindi words, not just repeated हिन्दी. Global mapping repair correctly refuses changed glyph reuse outside matching ActualText. The experimental contextual normalizer repairs 722 clusters, preserves all 3318 Hindi codepoints in logical order in pypdf and PDF.js, passes the other script inventories, and leaves all four rendered pages pixel-identical. This does not make it production-ready.

**Actual Safari 101% reprint still fails text preservation:** four pages and all eight paragraph start/end markers survive, but Hindi/Arabic extraction changes. PDF.js recovers only 97 Hindi codepoints after reprint. The source uses only Type0 fonts, so font subtype alone is not a pass criterion. Four new real-PDF regression tests preserve this failure. See `${VDOC_QA_EVIDENCE:-qa-evidence}/pdf-prefont-20261011/audit.json`, `analysis.json`, `pdfjs.json`, `regression.log`.

### Runtime boundary for the next implementation

The current product uses `window.print()`, which [opens the browser print dialog](https://developer.mozilla.org/en-US/docs/Web/API/Window/print); it does not return a generated PDF to application code. There is no PDF endpoint in this repository. The QA renderer launches installed Chrome and Python, which the shipped web page cannot substitute for a browser API.

Under the local-only web requirement, investigate client-side vector PDF generation as a separate bounded implementation. [pdf-lib supports browser execution and font embedding](https://pdf-lib.js.org/docs/api/classes/pdfdocument), but that alone does not reproduce the editor's layout or complex-script shaping; those remain implementation and acceptance work. Cloudflare's [PDF API](https://developers.cloudflare.com/api/resources/browser_rendering/subresources/pdf/methods/create/) is a remote browser service and is not selected for local-document export. No document was uploaded and no dependency/service was added.

Before integration: choose distributable fonts and preserve user font choices, produce the glyph/position/Unicode representation in-browser, test one mixed-script page and one overflowing table against the current preview, then implement bounded cancellation/download/errors. Keep the downloadable PDF separate from native printing; do not label a browser re-saved file as verified just because its page count matches. S054 and AI readiness remain open.

### Historical results below

## 2026-10-11: embedded-font path preserves native reprint text in fixture B

Using diagnostic local `Devanagari Sangam MN` and `Arial Unicode MS` fonts, followed by the guarded logical Unicode repair, produced a PDF containing only Type0 font resources. Actual Safari saves at 100%, 101%, and 93% retain five pages, all 206 normalized CJK codepoints, all 108 Hindi codepoints and 18 logical Hindi words. pypdf and PDF.js agree. The six repair mappings leave all five rendered pages pixel-identical to the new font-substituted source; this does **not** mean the substituted fonts match the original editor typography.

The new `VDOC_QA_CJK_FONT` option is diagnostic only. Existing system fonts are used locally; they are not copied to the product or offered for redistribution. Neither font substitution after pagination nor a Node/Chrome/Python process is a shipping web export architecture. The next integration gate is font/preview consistency before pagination and a supported local web runtime. S054 remains open.

`verify-acceptance.py` now checks CJK, Arabic and Hebrew codepoint inventories on each page, in addition to the earlier checks. Inventory does not prove RTL logical reading order or glyph shaping. `test-verify-acceptance.py` runs six regression tests against actual saved PDFs: four new direct/native candidates pass within this fixture scope; missing text, wrong Hindi order, and old extra-page failures are rejected. The original Safari 100% baseline fails the stronger Arabic and logical-Hindi checks; its historical structural pass was not full multilingual acceptance.

Evidence: `${VDOC_QA_EVIDENCE:-qa-evidence}/pdf-font-20261011/audit.json`, `strict-checks.json`, `pdfjs-text.json`, `regression.log`. All seven new PDFs / 35 pages rendered. Owned native windows closed, scale restored to 100%, temporary server stopped. Product source unchanged.

### Historical investigation (superseded where noted above)

## 2026-10-11: direct-PDF Unicode repair; native reprint still open

`repair-unicode.py --logical-order` now repairs the B fixture's direct PDF using its existing `ActualText` evidence. It changes only six proven font Unicode mappings, accounts for every occurrence of each changed glyph, and refuses conflicting or unannotated reuse. It preserves all text drawing operators, glyph data, and every pixel on all five rendered pages. pypdf and PDF.js recover all 18 Hindi words in logical order; the strict B verifier passes.

```sh
python3 tools/pdf-export/repair-unicode.py raw.pdf repaired.pdf \
  --logical-order --report repair.json
python3 tools/pdf-export/verify-acceptance.py repaired.pdf \
  --require-logical-hindi --report repaired.check.json
```

This is a guarded QA component, **not a universal PDF repair or a shipped export button**. Complex scripts must have suitable existing ActualText, all changed uses must agree, fixed-width CMaps and simple bfchar replacements must be supported, and there must be no unhandled Form XObjects. Six real-document tests cover conflicting reuse, unannotated reuse, insufficient Unicode, overwrite refusal, idempotence, and unchanged drawing operators with corrected text.

The null-only repair fixes inventory but leaves visual-order Hindi; the strict check rejects it. `normalize-actual-text.py` is an experimental font-alias variant, not the preferred implementation. Aliases, static-font substitution and incremental writing did not close native reprint acceptance.

**Safari reprint failure predates the repair.** The untouched Chrome prototype has 206 CJK characters after NFKC normalization and 36 Hindi codepoints; its existing native Safari reprint has zero of both. The repaired direct PDF has all 108 Hindi codepoints and 18 complete words, but its native reprint still loses these scripts from text extraction while preserving visible glyphs and five pages. The PDF source has Type3 fonts; the native reprint no longer contains those font resources. This is evidence for investigating font embedding/reprint conversion, not proof that the repair introduced the loss or that every Type3 font fails.

Native AX text was available for the first null-only repair but empty after later PDF navigations; those empty reads are **not** passes. Saved native PDFs are the authoritative reprint observations. The product remains unchanged. Next work: test a renderer/font embedding route that retains searchable text through Safari, then settle the supported local web export runtime and integrate the UI. Do not repeatedly tune ToUnicode mappings to fix an already-existing reprint conversion loss.

Evidence: `${VDOC_QA_EVIDENCE:-qa-evidence}/pdf-unicode-20261011/audit.json`, `comparison.json`, `strict-checks.json`, `global-tests.log`. All temporary native test windows/services were closed.


`render-prototype.cjs` imports a supplied VDoc JSON fixture into an isolated local Chrome profile, waits for the app's validated page preview, copies its rendered pages and styles into an isolated print page, and writes a vector/text PDF. It compares the complete editor document before and after export. HTTP requests are restricted to the selected loopback VDoc origin; the observed run made no external requests. It never attaches to the user's open browser.

Run with the existing VDoc development server and installed Playwright/Chrome:

```sh
VDOC_PLAYWRIGHT_MODULE=/absolute/path/to/playwright \
  node tools/pdf-export/render-prototype.cjs \
  "$(node tools/qa-path.mjs safari-preview/source.vdoc.json)" output/pdf/new-prototype.pdf
python3 tools/pdf-export/verify-acceptance.py output/pdf/new-prototype.pdf \
  --report output/pdf/new-prototype.check.json
```

Optional settings: `VDOC_QA_URL` (loopback only), `VDOC_CHROME_PATH`. The renderer refuses to overwrite an existing PDF. Python verification requires `pypdf` and `pdfplumber`.

## Verified scope and limitations

The B fixture produced five pages with unchanged source content. Its resulting PDF also remained five pages in actual Safari native printing at 100%, 101%, and 93%. Reprinting the previous correct Safari PDF stayed five pages at 93%, 99%, 100%, 101%, and 102%, preserving rows, headers, footers and the final paragraph.

**The Chrome prototype is not accepted:** Hindi text contains unmapped characters in both pypdf and PDF.js extraction. The default prototype's native Safari accessibility tree also exposes unmapped text. Native reprinting preserves page structure but does not restore the missing Hindi characters. PDF ActualText contains some correct clusters; that alone does not establish usable cross-viewer text extraction.

`VDOC_QA_DEVANAGARI_FONT` chooses an explicit diagnostic local font; `VDOC_QA_DEVANAGARI_FILE` embeds a diagnostic font file. These are deliberately recorded in the report and do not change the editor's font settings. Devanagari Sangam MN and the included OFL Noto font did **not** resolve the defect. Do not silently enable these fallbacks or count them as a product fix. Post-pagination font substitution can change line metrics and is only a diagnostic.

The verification tool is deliberately specific to B: expected rows on each page, unique headers/footers, page numbers, the fourth-page table ending, the fifth-page heading/body, selectable text, first-page image, glyph bounds, unmapped characters and Hindi codepoint inventory. It rejects the old non-100% Safari PDFs and all three incomplete Chrome prototypes. It does not certify arbitrary documents, reading order, all languages, glyph appearance, image quality or table borders. Review rendered pages as well.

## Before product integration

1. Resolve complex-script PDF text mappings and test actual selection/copy/search in target viewers, including native Safari.
2. Reconcile export typography and pagination with the user's preview; do not silently substitute fonts after pagination.
3. Choose a supported runtime: this local Node/Chrome prototype is not a Cloudflare endpoint, browser API, or offline web solution. Preserve the local-document privacy requirements before adding a server.
4. Integrate a cancellable, bounded export pipeline, resource/font readiness, cleanup and actionable errors through the existing operation layer.
5. Repeat original and complex-document PDF/export/print regressions, then verify the actual product button and saved-document integrity.

Evidence: `${VDOC_QA_EVIDENCE:-qa-evidence}/safari-fixed-pdf-20261011/audit.json`. Product code is unchanged. S054 and the overall Safari/AI gates remain open.
# Browser-only vector experiment — 2026-10-11

`browser-cluster-prototype.js` is an isolated QA experiment, **not an application export API**. It shapes source tokens in the page with HarfBuzz WASM, obtains their visible outlines with fontkit, and writes Type3 vector glyph clusters with PDF-lib. No document upload, raster fallback, invisible text overlay, Chrome PDF printing or Python repair is used. Explicit local OFL fonts are loaded before DOM measurement.

Eleven one-page PDFs and their renders are recorded in `${VDOC_QA_EVIDENCE:-qa-evidence}/browser-pdf-20261011/audit.json`. The final Arabic/Hebrew samples preserve source word order in pypdf and PDF.js. Grouping a word in one PDF text object matters: word-level Unicode mappings reversed RTL in PDF.js, while one text object per cluster reversed RTL in pypdf. Both failed variants remain in regression evidence.

**Hindi is still a blocker.** Removing whitespace makes character inventories agree, but PDF.js inserts spaces inside words and misreports positions. The installed PDF.js category regex matches `Mn` anywhere in a multi-codepoint mapping, then its text extractor treats that entire glyph as zero-width. Whole-word checks catch the resulting failure; do not approve based on a whitespace-stripped comparison. This diagnoses the bundled reader, not every PDF reader/version. Type3 reprint compatibility is also unresolved from earlier Safari evidence.

The QA runner verifies a real Blob download with matching SHA-256, preflight/in-flight cancellation and explicit rejection of missing glyphs, unsupported bold, page overflow, token overflow and measured-font mismatch. Source fixture HTML remains identical after tests. Three scripts were visually compared with browser screenshots. This does **not** cover arbitrary VDoc DOM, real pagination, mixed fonts, images, footers, selection UI, native Safari reprint or formal product download.

Host-local reproduction (bundled runtime paths are explicit in the runner):

```sh
# QA-only dependencies previously unpacked under tmp/browser-pdf-20261011:
# @pdf-lib/fontkit 1.1.1 and harfbuzzjs 1.6.3, both MIT.
# Versions, archive hashes and OFL font sources are retained in the fixture.
node tools/pdf-export/run-browser-prototype.cjs arabic cluster
VDOC_QA_SAFETY=1 node tools/pdf-export/run-browser-prototype.cjs words cluster
node tools/pdf-export/verify-browser-prototype.mjs
python3 tools/pdf-export/test-browser-prototype.py
```

The runner intentionally refuses to overwrite existing PDFs; use a fresh evidence destination for a rerun. It routes a fictional loopback origin entirely to local files, starts no server, rejects other origins, and closes its browser in `finally`. Seven artifact regressions passed, including assertions that failed variants stay rejected; this is not seven product gates passed. No npm dependency or product file was changed.
