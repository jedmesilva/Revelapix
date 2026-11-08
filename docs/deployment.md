# Deploy Revela to Vercel and Railway

The pnpm monorepo stays at the repository root. Deploy the static React/Vite
artifact to Vercel and the long-running Express API as a Railway service.

## Deploy the API first

Create a Railway service connected to this repository and leave its **Root
Directory** at the repository root. Configure the service with:

- Build command: `pnpm --filter @workspace/api-server run build`
- Start command: `pnpm --filter @workspace/api-server run start`
- Health check path: `/api/healthz`
- Node.js version: `24.x` (also pinned in the root `package.json`)
- Replicas: `1` until payment reconciliation is moved behind a distributed lock

Set these commands in Railway's service settings. This repo intentionally does
not add `railway.json`/`railway.toml`: Railway has deprecated that per-service
format for new services. Its replacement manages whole Railway projects and
requires linking and applying changes to a specific Railway environment.

The API listens on Railway's `PORT`. After the service starts, create or enable
its public domain and keep the resulting origin, including `https://`, without
a trailing slash. Configure that origin as `RAILWAY_API_ORIGIN` in the Vercel
project. The Vercel configuration uses it to proxy `/api/*` to Railway; browser
requests remain same-origin and continue using the existing session cookies.

If configuring monorepo watch paths, include the API, its shared libraries,
and root workspace files, for example:

- `artifacts/api-server/**`
- `lib/db/**`
- `lib/api-zod/**`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `package.json`
- `tsconfig.base.json`

## Deploy the interface

Connect the same repository to Vercel and set its **Root Directory** to the
repository root. The root `vercel.ts` configures:

- Install: `pnpm install --frozen-lockfile`
- Build: `pnpm --filter @workspace/revela build`
- Static output: `artifacts/revela/dist/public`
- `/api/*` proxy to `RAILWAY_API_ORIGIN`, followed by the SPA fallback

Set `RAILWAY_API_ORIGIN` in every Vercel environment where the site should call
the Railway API (Production, Preview, or Development). The Vercel project
configuration uses this non-secret origin at request time. Redeploy after
changing it.

## Railway environment variables

Set runtime variables and secrets in Railway, not in the Vercel frontend:

- `NODE_ENV=production`
- `DATABASE_URL` for the existing PostgreSQL database
- `SESSION_SECRET`, kept stable across deploys
- `PUBLIC_APP_ORIGIN` set to the final Vercel app origin, such as
  `https://revela.example.com`
- `SUPABASE_URL` and `SUPABASE_ANON_KEY` for Google sign-in
- The Efí credentials and Pix key for the selected Efí environment

For homologation, use `EFI_ENVIRONMENT=homologation` and the matching
development credentials. Production payments require Efí approval, production
credentials, `EFI_ENVIRONMENT=production`, and an explicit
`EFI_LIVE_PAYMENTS_ENABLED=true`. Do not enable live payments as part of the
initial deploy.

Do not expose `SUPABASE_SERVICE_ROLE_KEY` or any Efí, database, or session
secret to the frontend. The UI does not need them.

## OAuth and database setup

After choosing the final Vercel domain:

1. Set Railway's `PUBLIC_APP_ORIGIN` to that exact HTTPS origin.
2. Add `https://<vercel-domain>/api/auth/google/callback` to the Supabase Auth
   redirect URL allowlist and confirm Google sign-in is enabled there.
3. Apply the production database schema/security setup and seed data
   deliberately against the intended production `DATABASE_URL`; do not run
   schema changes automatically on every deploy.

Existing database scripts are documented in `replit.md`. Review the target
database and take the appropriate backup before applying schema changes.

## Remaining blocker: prize images

Prize image reads currently obtain credentials from a Replit-local sidecar at
`127.0.0.1:1106`. That sidecar is not available in Railway. Replace the image
storage adapter and configure an external storage provider before relying on
catalog images in production.

## Current deployment boundary

This repository prepares the application build and routing. Creating the
Vercel/Railway projects, adding their domains, entering secrets, configuring
Supabase redirects, and applying production database changes remain explicit
provider-side steps.
