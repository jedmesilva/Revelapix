# Revela

Experiência de células reveláveis com contas, chances, cobranças Pix pela Efí e resgates simulados.

## Run & Operate

- Install dependencies with `pnpm install --frozen-lockfile`.
- Start the managed `artifacts/api-server: API Server` and `artifacts/revela: web` services.
- After applying the database schema, seed the initial chance packages with `pnpm --filter @workspace/db run seed`.
- `pnpm run typecheck` — typecheck all workspace packages.
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API clients and validation schemas from OpenAPI.
- `pnpm --filter @workspace/db run push` — apply schema changes to the development database.
- `pnpm --filter @workspace/db run secure-public-api` — apply the Supabase public-schema security migration after schema changes.
- `pnpm --filter @workspace/db run verify-public-api-security` — verify that Revela tables fail closed to Supabase API roles.
- Required environment: `DATABASE_URL`.
- Efí secrets: `EFI_CLIENT_ID`, `EFI_CLIENT_SECRET`, `EFI_CERTIFICATE_BASE64` (P12 certificate encoded as base64), and `EFI_PIX_KEY`. If the certificate is password-protected, also set `EFI_CERTIFICATE_PASSWORD`.
- `EFI_ENVIRONMENT` defaults to `homologation`; use the matching Efí credentials and certificate. Production also requires `EFI_LIVE_PAYMENTS_ENABLED=true`.
- Enable the Efí application scopes `cob.write` and `cob.read`. The Pix key must belong to the authenticated Efí account.
- Efí payment status is checked server-side by polling its API. Do not add a public webhook unless the hosting edge can enforce Efí's required mutual TLS.
- Keep `SESSION_SECRET` stable while saved Pix/CPF profiles exist; changing it requires re-encrypting those profiles.
- Google sign-in also requires `SUPABASE_URL` and `SUPABASE_ANON_KEY`. Enable Google in Supabase Auth and allow the app's origin as a redirect URL; Google credentials belong in the Supabase provider settings.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite
- API: Express 5, with OpenAPI contracts and generated Zod validation
- Database: PostgreSQL + Drizzle ORM

## Where things live

- `artifacts/revela` — user interface
- `artifacts/api-server` — API routes and server-side business rules
- `lib/db/src/schema` — PostgreSQL schema
- `lib/api-spec/openapi.yaml` — API source of truth

## Data authority

- Accounts, password hashes, sessions, chances, cell ownership, prize data, Pix orders, reservation expiry, and redemption eligibility are server-owned and persisted in PostgreSQL.
- Google sign-in is validated by Supabase on the server, then linked to the app's PostgreSQL account by verified email and its provider identity.
- Redemption requests are persisted with a status linked to the revealed cell; new requests start as `requested`, and the cell exposes its current redemption status only to its owner.
- Cash movements are append-only and linked to a paid order or completed redemption. Test Pix purchases are recorded separately and never count as real cash; active redemption requests reserve funds but are not cash outflows.
- Redemption status changes are validated on the server and recorded in an event history. Admin access is controlled by the database `is_admin` flag, never by an unverified email address.
- The browser holds only transient form, navigation, and animation state; it requests server state for rendering and cannot authorize business actions.
- Revela database tables are server-only. RLS is enabled and forced with no Supabase client policies, and `anon`, `authenticated`, and `service_role` have no table privileges in `public`. The Express server remains the only application access path.
- The current Express database connection uses Supabase's `postgres` role, which has `BYPASSRLS`; RLS does not replace route-level authentication, ownership checks, or admin checks for server queries. Keep those checks server-side.
- The server confirms Efí charges by matching the provider's completed status, transaction ID, and amount before adding chances, revealing a reserved cell, or recording cash. Homologation payments are recorded as test money.
- Production payments stay blocked until `EFI_ENVIRONMENT=production` and `EFI_LIVE_PAYMENTS_ENABLED=true` are both configured. Confirm Efí approval and the legal requirements for the chance-based product before enabling them.
- Redemptions remain simulated: they do not verify Pix-key ownership or transfer money.

## Cash administration

- Grant administrator access only to an account you control. After the account exists, set `revela_users.is_admin` to `TRUE` for its row in the development database. Do not use email allowlists: password sign-up does not verify email ownership.
- The finance panel shows real cash separately from simulated purchase totals. Mark a redemption as completed only after the Pix has been sent outside the app; the app does not initiate transfers or store Pix keys/CPFs for later processing.
