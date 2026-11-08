# Revelapix

Plataforma de células reveláveis com contas, chances, cobranças Pix pela Efí e resgates simulados.

## Run & Operate

- Install dependencies with `pnpm install --frozen-lockfile`.
- Start the managed `artifacts/api-server: API Server` and `artifacts/revela: web` services.
- After applying the database schema, seed the initial chance packages with `pnpm --filter @workspace/db run seed`.
- `pnpm run typecheck` — typecheck all workspace packages.
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API clients and validation schemas from OpenAPI.
- `pnpm --filter @workspace/db run push` — apply schema changes to the development database.
- `pnpm --filter @workspace/db run secure-public-api` — apply the Supabase public-schema security migration after schema changes.
- `pnpm --filter @workspace/db run verify-public-api-security` — verify that Revelapix tables fail closed to Supabase API roles.
- Required environment: `DATABASE_URL`.
- Store Efí credentials in Replit Secrets, never in source control. Production uses `EFI_CLIENT_ID`, `EFI_CLIENT_SECRET`, and `EFI_CERTIFICATE_BASE64`; homologation uses `EFI_CLIENT_ID_DEVELOPMENT`, `EFI_CLIENT_SECRET_DEVELOPMENT`, and `EFI_CERTIFICATE_BASE64_DEVELOPMENT`. The Client ID, Client Secret, and P12 certificate must come from the same Efí environment. To encode a downloaded P12 certificate on Linux, run `base64 -w0 certificate.p12` and save the output under that environment's certificate secret; do not commit the original certificate.
- Set `EFI_PIX_KEY` to the Pix key registered with the Efí account. If homologation uses a different Pix key, set `EFI_PIX_KEY_DEVELOPMENT`; otherwise homologation uses `EFI_PIX_KEY`. For password-protected certificates, set `EFI_CERTIFICATE_PASSWORD` and, if different, `EFI_CERTIFICATE_PASSWORD_DEVELOPMENT`.
- `EFI_ENVIRONMENT` defaults to `homologation`; `development` is also accepted as an alias for homologation. Set it to `production` only with production credentials. The Efí application must grant `cob.write` and `cob.read`. Production also requires `EFI_LIVE_PAYMENTS_ENABLED=true` after Efí approval.
- Enable the Efí application scopes `cob.write` and `cob.read`. The Pix key must belong to the authenticated Efí account.
- Efí payment status is checked server-side by polling its API. Do not add a public webhook unless the hosting edge can enforce Efí's required mutual TLS.
- Keep `SESSION_SECRET` stable while saved Pix/CPF profiles exist; changing it requires re-encrypting those profiles.
- Email and password are the only authentication option currently exposed in the app. Google OAuth is disabled by default in the API; it requires `GOOGLE_OAUTH_ENABLED=true` plus Supabase configuration and an explicit frontend reintroduction to become usable. Keep the flag unset unless the user asks to re-enable it.

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
- Email/password sign-in is validated server-side, and auth state and sessions remain server-owned. Google-linked accounts are retained, but sign-in is disabled; users still logged in through Google can create a local password in account settings before ending their session.
- Redemption requests are persisted with a status linked to the revealed cell; new requests start as `requested`, and the cell exposes its current redemption status only to its owner.
- Cash movements are append-only and linked to a paid order or completed redemption. Test Pix purchases are recorded separately and never count as real cash; active redemption requests reserve funds but are not cash outflows.
- Redemption status changes are validated on the server and recorded in an event history.
- The browser holds only transient form, navigation, and animation state; it requests server state for rendering and cannot authorize business actions.
- Revelapix database tables are server-only. RLS is enabled and forced with no Supabase client policies, and `anon`, `authenticated`, and `service_role` have no table privileges in `public`. The Express server remains the only application access path.
- The current Express database connection uses Supabase's `postgres` role, which has `BYPASSRLS`; RLS does not replace route-level authentication or ownership checks for server queries. Keep those checks server-side.
- The server confirms Efí charges by matching the provider's completed status, transaction ID, and amount before adding chances, revealing a reserved cell, or recording cash. Homologation payments are recorded as test money.
- Production payments stay blocked until `EFI_ENVIRONMENT=production` and `EFI_LIVE_PAYMENTS_ENABLED=true` are both configured. Confirm Efí approval and the legal requirements for the chance-based product before enabling them.
- Redemptions remain simulated: they do not verify Pix-key ownership or transfer money.
