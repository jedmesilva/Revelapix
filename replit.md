# Revela

Experiência demonstrativa de células reveláveis, com contas, chances, pedidos Pix de teste e resgates simulados.

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
- Pix payment and redemption are demonstrations only. Payment simulation is disabled in production; redemptions do not verify key ownership or transfer money.

## Cash administration

- Grant administrator access only to an account you control. After the account exists, set `revela_users.is_admin` to `TRUE` for its row in the development database. Do not use email allowlists: password sign-up does not verify email ownership.
- The finance panel shows real cash separately from simulated purchase totals. Mark a redemption as completed only after the Pix has been sent outside the app; the app does not initiate transfers or store Pix keys/CPFs for later processing.
