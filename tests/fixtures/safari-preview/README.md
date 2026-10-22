# Safari preview failure sample

User-supplied backup on 2026-10-05, copied unchanged from the explicitly provided QA document. It contains the saved IME test text; this alone is not proof of candidate-window/cancellation/undo acceptance.

SHA-256: `a1c397e5a22a5446c06aae46f84c1d48db1e6f2af7148f6651a8e3e5e8a4245b`

User Safari screenshot reported `Content extends beyond page 1` and printing was disabled. The identical backup was imported through the in-app browser file chooser as document `3fcf3049-c917-44a5-bd9f-8a36e1ca4a33`; its 2,498-character document produces five pages and passes existing integrity/overflow checks there. Source fixture fields match the baseline except for the IME paragraph; the saved backup also contains normal schema defaults and generated stable IDs.

The Safari-specific cause is unresolved. The overflow error now reports object kind, edge and excess pixels; printing protection remains enabled. This fixture records a reported cross-browser failure, not a passing Safari test. No private browser sessions were accessed.

## Follow-up width fix

User reported the detailed error: table crosses the right edge of page 1 by 1794px. Automatic table width was left as inherited 100% while fitting only compared minimum column sizes. The disposable print source now resolves automatic/percentage widths to one printable page and allocates automatic columns before fragmentation. The exact fixture has a 641.52px table with two 320.76px columns; the saved document stays unchanged. In-app browser remains five pages with 36 body rows and four repeated headers. Safari confirmation is pending; do not mark the reported failure resolved without it.

## Continued failure / final-flow repair

User confirmed the same 1794px error after the width fix. This nearly equals the A4 page width plus Paged.js's 1000px temporary column gap offset. The final DOM now exits that measuring column flow only after pagination and before all final geometry checks. In-app browser still renders five complete pages; Safari confirmation remains pending. The prior width patch alone did not resolve the reported failure.

## Bottom-edge follow-up

User now reports a 5px bottom overflow on page 1, rather than the 1794px horizontal displacement. A bounded second pagination pass reserves measured bottom excess plus 2px (7px for this report) when excess is at most 8px. It retains the original 2px overflow threshold and every final integrity check. Larger/horizontal or persistent failures still disable printing. In-app remains five pages with 36 body rows and four headers; lifecycle regression simulates the retry branch. Actual Safari success and PDF output remain unconfirmed.

User subsequently confirmed after refreshing Safari: preview is normal and Print / Save PDF is clickable. The reported preview overflow is resolved for this fixture. Actual saved PDF integrity and the separate project-plan blank final page remain unverified. Full 79-file/1111-test suite, typecheck and production build pass.

## Actual Safari PDF: repeated footer-only pages

User supplied `/Users/ph.qian/Desktop/QA final system acceptance.pdf`, SHA-256 `460fc7c9da52710f1fdfaeab3927de217511fdab73c0ef93cf79545216c5cf80`. All ten pages rendered and reviewed. Body rows 01–36 occur once on physical pages 1/3/5/7; final heading is on page 9. Even pages contain only document footer/page number. The five-page preview became ten physical pages, so native PDF acceptance fails despite complete text. Added final native print rules with explicit sheet dimensions, zero additional paper margins and no fragmentation inside a preview sheet. Original file preserved; corrected Safari PDF must still be reviewed.

## Same ten-page output after explicit sheet sizes

Second PDF SHA-256 `4ee8749e04ca4fa47da1b06dadd314f5174f253f20995f459538d3b378735400` still has ten pages. Turning Safari headers/footers off did not help. User reports scale 93% gives nine pages, 101% gives 21; manual scaling is not accepted as a fix. PDF matrices show ~0.8008075pt per CSS pixel (595/743), e.g. the source 300px image prints at 240.2423pt instead of 225pt. Native root containers were auto-width while their sheets had fixed physical width. Print CSS now fixes root widths to the same paper width, overriding Paged.js max-width:100%. Current Safari retest remains pending; do not mark the preceding size-only fix successful.

## Five-page PDF verified at A4 / 100%

Latest PDF SHA-256 `bfcebc5fc733b95a8c51069027e5add5fcc6d44417694be62b7e85335f46cf5a`. All five pages visually inspected: 36 body rows once, four table headers, image, multilingual sample text and headers/footers/page numbers intact. Page 5 contains the explicit FINAL PAGE CHECK heading and ending paragraph; it is not blank. This confirms the root-width correction for A4/100% in the user's Safari. User reports 101% still produces 12 pages, an unresolved native scale limitation; no PDF at that scale inspected. The UI now states the supported matching print settings. The separate project-plan PDF still needs its own retest.

## Fresh native Safari PDF verified on 2026-10-10

The original source was imported into an authorized, separate Private Safari test window as document `086c8e8e-1529-437a-82e1-7395146ff767`; the editor showed 2,498 characters and Saved locally. Original `IMe` search from the document end returned to the highlighted first-page sentence.

[qa-system-20261010-100.pdf](qa-system-20261010-100.pdf) is a new native Safari output at A4 portrait / 100%, backgrounds on, Safari headers/footers off. SHA-256 `41771f9322cd457dabffcf46d7b19bf0d9414b243ba4a43b807e6474ccd6bbaa`, 113062 bytes. Text extraction and visual inspection of all five Poppler-rendered pages confirm all 36 body rows once, image, repeated table headers, document page numbers and final heading/ending paragraph, with no blank page or visible clipping. [Audit JSON](qa-system-20261010-100-audit.json) records the checks. pypdf warned about ignored invalid object offsets; extraction and all five Poppler renders completed, and the PDF was not rewritten.

Preview initially timed out; foreground retry recovered five pages. Another reopening again waited for pagination, so the intermittent loading issue remains open. A separate Safari iframe diagnostic received the preview ready handshake in 358ms; this isolates route availability but does not establish the timeout cause. This new 100% PDF does not close 101% scaling, the separate project-plan output, or other native acceptance gates.
