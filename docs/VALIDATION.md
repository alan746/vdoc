# Validation guide

## Automated checks

Run from the project root:

```sh
npm ci --no-audit --no-fund
npm run typecheck
npm run lint
npm test
npm run build
npm run test:worker
```

Use focused tests during development, then run the full suite for a release candidate. Keep tests, builds, and rendering sequential. Tests use one worker.

Worker smoke checks a temporary local server, rendered routes, responses, and assets. It does not deploy or require a Cloudflare account.

## Verification layers

| Layer | Establishes |
| --- | --- |
| Domain/operations | Schemas, explicit targets, atomicity, revisions, and undo |
| Storage | Repository contracts, transactions, migration, and controlled failures |
| Components | Controls, state, selection, focus, and feedback |
| Conversion | Text and formatting within supported paths |
| Browser | Layout, scrolling, and actual interaction |
| Native | Input methods, delivery, printing, termination, and quotas |
| Services | Authenticated users, deployed ownership, sockets, and failures |

## Recording results

Record revision, command, exit status, environment, sample, and relevant files. Historical counts belong to their original revision. Earlier success does not establish a changed candidate passed.

Use exact JSON and multilingual comparisons. Inspect visual artifacts for layout. Separate product failures from unavailable environments and preserve unresolved cases.

Historical artifacts are indexed in [QA_EVIDENCE.md](QA_EVIDENCE.md). Machine-readable manifests and executable fixtures retain original data. Procedures: [checklist](ACCEPTANCE_CHECKLIST.md), [native runs](NATIVE_ACCEPTANCE_RUNBOOK.md), and [final worksheet](acceptance/FINAL_FIVE_ACCEPTANCE.md).
