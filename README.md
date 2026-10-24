# VDoc

VDoc is a voice-first document editor for writing, formatting, and revising personal documents. It combines an English editing workspace with local storage, optional cloud documents, voice sessions, and common file formats.

## Getting started

Use Node.js 22.13 or later.

```sh
npm ci
npm run dev
```

The development server normally listens on `http://localhost:5173`. Use the address printed in the terminal. Local editing works without a cloud account.

To run a production build locally:

```sh
npm run build
npm start -- --port 8787
```

The local server serves the editor and PDF rendering on the loopback interface. It uses an installed Chrome or Chromium browser for fixed-layout PDFs. Set `VDOC_PDF_CHROME` to an absolute browser executable path when automatic discovery is unavailable. A browser print fallback remains available.

Keep the same hostname and port when switching servers to retain access to the same browser storage. `localhost` and `127.0.0.1` have separate storage. `npm run start:worker` starts the Worker application without the local PDF service.

## Features

- Rich text with headings, links, colors, highlights, font sizes, superscripts, and subscripts.
- Paragraph direction, alignment, spacing, indentation, borders, backgrounds, and pagination controls.
- Numbered lists, bullet lists, checklists, quotations, code blocks, footnotes, and a live table of contents.
- Tables with row and column editing, merged cells, resizing, borders, sorting, pinned headers, and right-to-left column order.
- Unicode-aware search and replacement, character counts, document language, spelling controls, and keyboard shortcuts.
- Local images, page settings, page breaks, headers, footers, and page numbers.
- IndexedDB autosave, folders, search, copies, favorites, trash, and named versions.
- JSON backups, DOCX and TXT imports, DOCX/HTML/TXT/JSON exports, and PDF printing.
- Authenticated cloud documents and voice editing through a separate document service.
- Explicit document operations with target validation, revision checks, atomic batches, and turn-specific undo.

Voice connections require a configured cloud account, an owned cloud document, and the corresponding server deployment. Local documents show a migration entry point. Credentials stay on the server. See [cloud setup](docs/CLOUD_WORKSPACE.md), [sign-in](docs/GOOGLE_SIGN_IN.md), and [the realtime protocol](docs/REALTIME_PROTOCOL.md).

## Using the editor

Use **File** for documents, imports, exports, language, and printing; **Edit** for search and history; **Insert** for images, tables, footnotes, and the table of contents; and **Format** for page, paragraph, and list properties. Select a table to open its controls or use the context menu. Save checkpoints through **Edit history > Saved versions**.

The editing canvas is continuous; page preview creates a separate read-only paginated snapshot. Complex DOCX layouts and multilingual PDF text extraction have documented limits. Backups accept up to 20 MB and individual images up to 2 MB. Local documents depend on browser storage; clearing site data removes them. Keep external backups.

Autosave merges changes after 450 ms of idle time and schedules a write after at most two seconds of continued editing. Scheduling does not guarantee disk durability. Operation history lasts for the current session; named versions persist, with up to 40 checkpoints.

## Development checks

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run test:worker
```

Run full tests, builds, and rendering checks sequentially. The test runner uses one worker. The Worker smoke check starts a temporary local server and checks server-rendered routes and their referenced assets.

Set `ANALYZE=1` for a build to write the client module report to `dist/bundle-report/client.json`. Keep the checkout outside synchronized folders, or exclude it from synchronization, to avoid conflict copies such as `engine 2.ts`.

## Project structure

| Path | Responsibility |
| --- | --- |
| `app/` | Routes, API handlers, and global styles |
| `components/editor/` | Workspace, toolbar, dialogs, table controls, and version history |
| `lib/domain/` | Document entities, operation schemas, pure rules, and Unicode utilities |
| `lib/usecases/` | Editing transactions, autosave, document navigation, and repository ports |
| `lib/editor/` | Tiptap and ProseMirror features, commands, validation, and rendering |
| `lib/infrastructure/` | Storage, file conversion, previews, PDF rendering, and realtime adapters |
| `lib/composition/` | Dependency wiring for repositories, services, and the interface |
| `tests/` | Automated checks and exact-byte fixtures |
| `docs/` | Interfaces, deployment, acceptance scope, and evidence references |
| `eval/voice/` | Voice workflow evaluation |

Dependencies point inward: `composition -> (editor, infrastructure) -> usecases -> domain`. ESLint enforces layer boundaries.

### Extending file formats

Register formats in `lib/composition/file-formats.ts`. A registration declares its identifier, label, file extensions, import limits, and importer/exporter strategies. Implement the repository ports in the infrastructure layer; shared menus and file inputs consume the registry automatically. Exporters receive a snapshot and return a Blob. Prepared exports can retain a download link while editing continues. Paginated exports use the preview pipeline.

### Extending editor features

Each `lib/editor/<feature>/index.ts` exports an `EditorFeature` containing extensions, command handlers, optional CSS, validation rules, and stable-ID node types. Add the object to `editorFeatures` in `lib/editor/feature-list.ts`.

Extensions, commands, styles, and backup validation share this registration list. Ordering is stable for equal priorities. Public operation schemas belong to the domain layer; their implementations belong to the corresponding feature. The domain tree validator receives rules through parameters and does not import editor code.

The schema baseline and feature-registration tests cover extension order, duplicate handlers, stable IDs, validation, and disabled features.

## Documentation

- [Document operations](docs/OPERATIONS.md)
- [Realtime protocol](docs/REALTIME_PROTOCOL.md)
- [Cloud library API](docs/CLOUD_LIBRARY_API.md)
- [Neon deployment](docs/NEON_DEPLOYMENT.md)
- [Validation guide](docs/VALIDATION.md)
- [Native acceptance](docs/NATIVE_ACCEPTANCE_RUNBOOK.md)
- [Multilingual coverage](docs/MULTILINGUAL_ACCEPTANCE.md)
- [QA evidence index](docs/QA_EVIDENCE.md)

Historical screenshots, logs, and source manifests are indexed separately from executable fixtures. Recorded results apply to their stated source revision, browser, platform, and sample.
