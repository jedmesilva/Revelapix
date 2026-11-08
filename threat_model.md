# Threat Model

## Project Overview

Revelapix is a React/Vite interface backed by an Express API and PostgreSQL. Users can register or sign in with Google, reveal cells, create demonstration Pix orders, and request prize redemptions. Payment simulation is intended only for development; real transfers are not performed by the app.

The browser uses the Express API rather than querying application tables directly. The Supabase Data API roles have no access to the `public` application tables; RLS is enabled and forced with no client policies. The Express server connects as `postgres`, which has `BYPASSRLS`, so server-side authorization remains essential.

## Assets

- **Account credentials and sessions** — email, names, Scrypt password hashes, database session-token hashes, and the browser session cookie. A stolen session or reused password can enable account impersonation.
- **User and business records** — cell ownership, chances, orders, demonstration Pix payloads, redemption requests, status history, and cash-ledger entries. Unauthorized changes could corrupt balances, awards, or redemption state.
- **Redemption details** — Pix keys and CPF values submitted for a redemption are sensitive personal and financial information.
- **Application secrets** — `DATABASE_URL` connects with a role that bypasses RLS; `SESSION_SECRET` protects encrypted redemption-profile data; Supabase service credentials must remain server-side.

## Trust Boundaries

- **Browser to Express API** — the browser is untrusted. Public state and account endpoints are reachable without a session; user actions must be validated and authorized by the server.
- **Express API to PostgreSQL** — the API uses a privileged `postgres` connection that bypasses RLS. The application’s session and ownership checks are the effective authorization boundary for these queries.
- **Supabase Data API to PostgreSQL** — `anon`, `authenticated`, and `service_role` are blocked from the `public` tables, sequences, functions, and schema creation. Keep those grants and default privileges closed.
- **Express API to Supabase Auth** — Google sign-in passes through Supabase’s OAuth flow. Provider identity and verified email are checked before linking an application account.
- **Express API to object storage** — public prize images are looked up under configured search paths. User-controlled path segments must not escape those paths.

## Scan Anchors

- Production API entry: `artifacts/api-server/src/app.ts` and `artifacts/api-server/src/routes/`.
- Authentication and session handling: `artifacts/api-server/src/lib/auth.ts`, `artifacts/api-server/src/lib/google-auth.ts`, and `artifacts/api-server/src/middlewares/rate-limit.ts`.
- User, order, reveal, and redemption operations: `artifacts/api-server/src/routes/revela.ts`.
- Database schema and public API hardening: `lib/db/src/schema/`, `lib/db/sql/public-api-security.sql`, and `lib/db/scripts/`.
- Public image serving: `artifacts/api-server/src/routes/storage.ts` and `artifacts/api-server/src/lib/objectStorage.ts`.
- `artifacts/mockup-sandbox` is a development preview service, not the production API.

## Threat Categories

### Spoofing

Local registration accepts passwords with a six-character minimum. Passwords are Scrypt-hashed, and sessions use random tokens stored as SHA-256 hashes in PostgreSQL; the cookie is HTTP-only and SameSite strict, with Secure enabled in production. Login and registration have per-process rate limits, but the default in-memory limiter is not a shared limit across autoscaled API instances. Credential reuse and distributed authentication abuse are therefore the most likely account-entry risks. Use a shared rate-limit store, alert on abnormal login failures, and consider stronger password requirements.

### Tampering

Orders derive package prices from server-side records; reveal, order, and redemption operations check session identity and ownership, and sensitive state changes use database transactions and locks. Preserve these guarantees with tests for cross-user object access, concurrent requests, payment-simulation availability, and redemption status transitions. Never accept client-provided prices or ownership as authoritative.

### Repudiation

Redemption status changes are recorded in an event table with actor and timestamps, and logs should continue to omit request bodies, cookies, and secrets.

### Information Disclosure

The unauthenticated state endpoint returns a public projection; user-specific order and redemption details must remain scoped to the authenticated user. Direct Supabase table access is blocked, but compromise of `DATABASE_URL` is high impact because its role bypasses RLS. Keep database and service credentials in workspace secrets, never in browser bundles or logs, and rotate them if exposure is suspected.

### Denial of Service

Authentication uses synchronous Scrypt work, while rate limits are held in process memory. The public state endpoint also performs board initialization/reservation-expiry database work as part of serving a request. Together these make unauthenticated traffic the easiest availability-abuse path. Prefer shared rate limiting, monitor authentication and state-request volumes, and move recurring maintenance work out of the public request path.

### Elevation of Privilege

The database connection bypasses RLS, so a missed or weakened route-level session or ownership check could expose another user’s records. Test authorization at every public server route; if database-enforced per-user isolation is required, migrate runtime access to a non-bypass role with transaction-scoped identity and explicit policies.
