# Revela

Experiência demonstrativa de células reveláveis, com contas, chances, pedidos Pix de teste e resgates simulados.

## Run & Operate

- Install dependencies with `pnpm install --frozen-lockfile`.
- Start the managed `artifacts/api-server: API Server` and `artifacts/revela: web` services.
- After applying the database schema, seed the initial chance packages with `pnpm --filter @workspace/db run seed`.
- `pnpm run typecheck` — typecheck all workspace packages.
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API clients and validation schemas from OpenAPI.
- `pnpm --filter @workspace/db run push` — apply schema changes to the development database.
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
- The browser holds only transient form, navigation, and animation state; it requests server state for rendering and cannot authorize business actions.
- Pix payment and redemption are demonstrations only. Payment simulation is disabled in production; redemptions do not verify key ownership or transfer money.
