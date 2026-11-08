#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter db push
pnpm --filter @workspace/db run secure-public-api
pnpm --filter @workspace/db run seed
