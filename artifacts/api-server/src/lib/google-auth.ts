import { createServerClient, parseCookieHeader, serializeCookieHeader } from "@supabase/ssr";
import type { Request, Response } from "express";

const OAUTH_COOKIE_NAME = "revela_google_oauth";
const OAUTH_COOKIE_PATH = "/api/auth/google";
const OAUTH_COOKIE_TTL_SECONDS = 10 * 60;

export type GoogleAuthConfig = {
  enabled: boolean;
  supabaseUrl: string;
  supabaseAnonKey: string;
};

export function getGoogleAuthConfig(): GoogleAuthConfig {
  const supabaseUrl = process.env.SUPABASE_URL?.trim() ?? "";
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY?.trim() ?? "";
  return {
    enabled: Boolean(supabaseUrl && supabaseAnonKey),
    supabaseUrl,
    supabaseAnonKey,
  };
}

export function getPublicAppOrigin(): string | null {
  const publicAppOrigin = process.env.PUBLIC_APP_ORIGIN?.trim();
  const configuredDomains = [
    ...(publicAppOrigin ? [publicAppOrigin] : []),
    ...(process.env.REPLIT_DOMAINS ?? "").split(","),
    process.env.REPLIT_DEV_DOMAIN ?? "",
  ];
  const configuredDomain = configuredDomains.map((domain) => domain.trim()).find(Boolean);
  if (!configuredDomain) return null;

  try {
    const url = new URL(
      configuredDomain.includes("://") ? configuredDomain : `https://${configuredDomain}`,
    );
    const localHttpAllowed = process.env.NODE_ENV !== "production"
      && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
    if (
      (url.protocol !== "https:" && !(url.protocol === "http:" && localHttpAllowed))
      || url.pathname !== "/"
      || url.search
      || url.hash
    ) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function createGoogleSupabaseClient(
  req: Request,
  res: Response,
  config: GoogleAuthConfig,
  options: { clearSessionWrites?: boolean } = {},
) {
  return createServerClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      flowType: "pkce",
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    cookieOptions: {
      name: OAUTH_COOKIE_NAME,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: OAUTH_COOKIE_PATH,
      maxAge: OAUTH_COOKIE_TTL_SECONDS,
    },
    cookies: {
      getAll() {
        return parseCookieHeader(req.headers.cookie ?? "");
      },
      setAll(cookiesToSet, cacheHeaders) {
        for (const cookie of cookiesToSet) {
          const isVerifierCookie = cookie.name.startsWith(`${OAUTH_COOKIE_NAME}-`)
            && cookie.name.endsWith("-code-verifier");
          if (options.clearSessionWrites && (!isVerifierCookie || cookie.value !== "")) continue;

          res.append("Set-Cookie", serializeCookieHeader(cookie.name, cookie.value, {
            ...cookie.options,
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            path: OAUTH_COOKIE_PATH,
            maxAge: cookie.value ? OAUTH_COOKIE_TTL_SECONDS : 0,
          }));
        }
        for (const [name, value] of Object.entries(cacheHeaders ?? {})) {
          res.setHeader(name, value);
        }
      },
    },
  });
}

export function clearGoogleOAuthCookies(req: Request, res: Response): void {
  for (const { name } of parseCookieHeader(req.headers.cookie ?? "")) {
    if (!name.startsWith(`${OAUTH_COOKIE_NAME}-`) || !name.endsWith("-code-verifier")) continue;
    res.append("Set-Cookie", serializeCookieHeader(name, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: OAUTH_COOKIE_PATH,
      maxAge: 0,
    }));
  }
}
