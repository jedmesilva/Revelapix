import { deploymentEnv, routes, type VercelConfig } from "@vercel/config/v1";

const railwayApiOrigin = deploymentEnv("RAILWAY_API_ORIGIN");

export const config: VercelConfig = {
  installCommand: "pnpm install --frozen-lockfile",
  buildCommand: "pnpm --filter @workspace/revela build",
  outputDirectory: "dist/public",
  rewrites: [
    routes.rewrite("/api/(.*)", `${railwayApiOrigin}/api/$1`),
    routes.rewrite("/(.*)", "/index.html"),
  ],
};
