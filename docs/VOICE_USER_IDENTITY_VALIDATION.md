# Trusted voice-session identity validation

## Contract and coverage

Create, renew, and end requests use the stable ID from `getRequestUser()`. Browser identity fields, cookies, authorization, and request IDs cannot override trusted context. Extra identity fields in request bodies are rejected.

IDs contain 1-128 ASCII characters, begin with a letter/digit, and subsequently allow `.`, `_`, `:`, and `-`. Reject whitespace, Unicode, paths, and line breaks. Upstream requests receive independent UUIDs; lifecycle calls retain the same authorized user and room.

| Check | Boundary |
| --- | --- |
| Ownership | Authorization and SQL behavior in local database fixtures |
| Isolation | Identical import IDs in different accounts use different rooms |
| SDK lifecycle | Create, renew, and end through handlers with fixture sockets |
| Quotas | Only allowed categories and valid positive retry seconds are exposed |
| Filtering | Private details, credentials, and oversized errors are withheld |
| Feedback | Concurrency, rate, and unavailable quota storage have distinct messages |

## Configuration

| Variable | Purpose |
| --- | --- |
| `AUTH_BASE_URL` | Browser origin |
| `GOOGLE_CLIENT_ID` | OAuth application identifier |
| `GOOGLE_CLIENT_SECRET` | Server-side OAuth credential |
| `BETTER_AUTH_SECRET` | Authentication signing material |
| `DATABASE_URL` | Migrated database connection |
| `VDOC_SERVER_URL` | Actual HTTPS backend origin |
| `VDOC_SERVER_CLIENT_KEY` | Registered server-to-server key |

The backend requires the matching registered key and trusted headers. Do not use shared identity to bypass authorization. Keep local variables ignored and production credentials in the hosting secret store.

## Rollout and acceptance

Deploy trusted-user backend support before the application proxy. End legacy shared sessions and reconnect; their usage cannot be safely reassigned. Preserve ownership checks during rollback and disable voice configuration if an older proxy cannot meet the contract.

Real sign-in, remote databases, deployed sockets, live editing, two-user quotas, and quota-store recovery require deployed acceptance. Fixtures do not establish billing balances or recognition quality.

See [sign-in](GOOGLE_SIGN_IN.md), [deployment](NEON_DEPLOYMENT.md), [cloud workspace](CLOUD_WORKSPACE.md), and [protocol](REALTIME_PROTOCOL.md).
