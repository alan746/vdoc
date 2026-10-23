# Cloudflare + Neon rollout

Cloudflare runs the web application and server API. Neon stores accounts,
login sessions, library items and document history. The separate `vdoc-server`
Worker and Durable Objects continue to own voice sessions and live connections.
No Node server, Nginx service or replacement voice-session database is required.

## 1. Database foundation

Create a Neon PostgreSQL project and a separate development branch. Select its
connection string from **Connect**. Keep that value outside git and chat logs.
Use a disposable branch for migration testing before applying to production.

Set `DATABASE_URL` in your local shell using your secret manager, then run:

```sh
npm ci
npm run db:migrate
```

The migration journal records completed migrations. Migrations use a transaction and an advisory lock to serialize operators;
a failure rolls back schema changes and the journal together. They are deliberately not run by the Worker,
`npm run build`, PR previews, or application startup. Review new SQL before
applying it; use a Neon branch/backup before a destructive migration.

In Cloudflare, open **Workers & Pages → vdoc → Settings → Variables and secrets**
and add `DATABASE_URL` as a **Secret**. The document API lives in the web Worker;
do not put this secret in browser code, a `NEXT_PUBLIC_*` variable, or wrangler
`vars`. Give previews their own Neon branch and credentials.

Generate subsequent migrations with `npm run db:generate`. Commit both SQL and
`drizzle/meta`; do not edit already-applied migration files. `db/schema.ts` is
PostgreSQL. The optional D1 example is independent and does not configure Neon.

## Data model and ownership

- `app_user`, `auth_account`, `auth_session`, `auth_verification`: standard
  authentication tables for the subsequent login integration.
- `library_item`: documents and folders, scoped by `(owner_id, id)`; document
  content is JSONB. Parent references cannot cross account boundaries.
- `document_version`: snapshots tied to the same owner's document.
- `revision`: optimistic concurrency counter, distinct from `format_version`.
  APIs must update with the expected revision and return conflict on a stale
  write, instead of silently overwriting another device's edits.
- `deleted_at`: synchronization tombstone. APIs must exclude deleted items from
  normal reads and prevent stale offline clients from resurrecting them.

SQL constraints are defense in depth, not request authentication. Application
queries must always scope by the verified login's user ID. A connection string
is a privileged server credential; never expose a direct database query API.
Parent-folder type, ancestor cycles, permissions and payload limits are checked
by the subsequent API layer. Sharing is not enabled by this foundation.

This first stage is additive: installing/migrating these tables does not upload
existing browser documents, enable login, or switch the editor away from local
storage. Login and authenticated document APIs are separate rollout stages.
Anonymous documents must be imported explicitly into a chosen account.

## Verification

`npm test -- tests/neon-schema.test.ts` executes the migration on PGlite's
PostgreSQL engine and checks owner-scoped references, history isolation,
constraints and competing revision updates. It requires no external credentials.
A successful local test does not prove a real Neon connection; after supplying
credentials, apply the migrations to a Neon development branch before rollout.
