# Google sign-in on Cloudflare with Neon

Depends on the Neon foundation migration in `docs/NEON_DEPLOYMENT.md`. Apply that
migration to a **test Neon branch first**. Sign-in runs in the **vdoc web Worker**,
which also hosts `/api/auth/*`; it does not run in the voice-only `vdoc-server`.

## Configuration

Create a Google OAuth web application. For production set:

- Authorized JavaScript origin: `https://vdoc.ink`
- Authorized redirect URI: `https://vdoc.ink/api/auth/callback/google`

If Google's consent screen is in testing mode, add the test users there. Public
release requires the appropriate consent-screen publishing steps in Google.

Set these **runtime bindings on the vdoc Worker**, not frontend build variables:

| Binding | Type | Value |
| --- | --- | --- |
| `DATABASE_URL` | Secret | Neon PostgreSQL connection string |
| `AUTH_BASE_URL` | Variable | `https://vdoc.ink` |
| `BETTER_AUTH_SECRET` | Secret | Random value of at least 32 characters, e.g. output of `openssl rand -hex 32` |
| `GOOGLE_CLIENT_ID` | Variable or Secret | OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Secret | OAuth client secret |

Do not prefix these values with `k1:` or `vdoc-web:`. Those prefixes belong to
the separate voice service protocol. Do not commit credentials or put them in
`NEXT_PUBLIC_*` variables. Keep `BETTER_AUTH_SECRET` stable: changing it invalidates
session cookies and the key used to encrypt stored Google OAuth tokens.

Use a fixed canonical HTTPS address. Sign-in is disabled on alternate hostnames
such as a workers.dev URL when `AUTH_BASE_URL` points to vdoc.ink. For local testing,
`http://localhost:3000` is allowed; register its exact callback URI separately.
Preview deployments must use separate Google configuration, signing secrets and
a test Neon branch. Never give an unreviewed PR preview production credentials.

## Verify after deployment

1. Open `/account` (the V avatar in the document library links here).
2. Sign in with Google; confirm the displayed email matches the chosen account.
3. Use a different browser profile with a second Google account and check its
   distinct account identity. The database creates separate user/session records.
4. Sign out, refresh, and confirm the old session no longer authenticates.
5. Close and reopen the browser; a valid session survives until logout or expiry
   (seven days). Expired sessions require Google sign-in again.

The server verifies the signed HttpOnly cookie against a live Neon session row.
Client-provided `oai-authenticated-user-*` headers are no longer accepted as login.
OAuth state, provider tokens, and sessions are handled by Better Auth; stored
provider tokens are encrypted. Account linking and password login are disabled.
Only Google sign-in/callback and logout are exposed under `/api/auth`;
`/api/account` returns the minimal user identity without session tokens.
Mutations require the configured origin and callbacks are fixed to `/account`.
Identity responses are private/no-store and omit session credentials.

The voice proxy uses this identity and checks that the document belongs to this
user in Neon. Anonymous/local-only documents are not voice-authorized; import
them into the cloud workspace first. See `CLOUD_LIBRARY_API.md` and
`CLOUD_WORKSPACE.md` for ownership and sync behavior.

## Scope and operational checks

The account page opens the cloud workspace at `/cloud`. The original `/` workspace
remains local and never uploads automatically. Google sign-in does not turn old
anonymous files into account-owned files. A database outage returns a generic
failure without logging credentials. Logout requires successful durable revocation
before reporting success. Rate limiting supplied by Better Auth is per process;
use Cloudflare rate-limiting rules for a global production limit.

Automated tests use the real Better Auth handler and PostgreSQL engine (PGlite)
for signed/forged/expired cookies, two users, OAuth state creation, CSRF rejection,
fixed callback URLs, unsolicited callbacks, logout and replay. Google consent and
the live Neon connection require the manual checks above; tests do not fake a
successful Google callback and do not prove those external credentials are valid.
