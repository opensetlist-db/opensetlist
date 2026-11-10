import { createClient } from "@supabase/supabase-js";
import { DEV_PROJECT_REF, pointsAtSupabaseProject } from "../../scripts/dev-db-guard.mjs";

export const mcpPath = "/api/bd-dot/mcp";
export const metadataPath = "/.well-known/oauth-protected-resource" + mcpPath;
const chatGptCallback = /^https:\/\/chatgpt\.com\/connector\/oauth\/[a-z0-9_-]+$/i;
const deployments = {
  preview: { environment: "dev", projectRef: DEV_PROJECT_REF, origin: /^https:\/\/[a-z0-9-]+-opensetlist-projects\.vercel\.app$/ },
  production: { environment: "production", projectRef: "prjjgxjdbvooqjiiumew", origin: /^https:\/\/opensetlist\.com$/ },
} as const;

export function bdDotConfig() {
  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv !== "preview" && vercelEnv !== "production") return null;
  const { environment, projectRef, origin: allowedOrigin } = deployments[vercelEnv];
  const supabaseUrl = `https://${projectRef}.supabase.co`;
  const origin = process.env.BD_DOT_OAUTH_ORIGIN;
  const clientId = process.env.BD_DOT_OAUTH_CLIENT_ID;
  const subject = process.env.BD_DOT_OAUTH_SUBJECT;
  const redirectUri = process.env.BD_DOT_OAUTH_REDIRECT_URI;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!pointsAtSupabaseProject(process.env.DATABASE_URL ?? "", projectRef) ||
      process.env.NEXT_PUBLIC_SUPABASE_URL !== supabaseUrl ||
      !origin || !allowedOrigin.test(origin) ||
      !clientId || !subject || !redirectUri || !chatGptCallback.test(redirectUri) || !anonKey) {
    return null;
  }
  return { environment, origin, clientId, subject, redirectUri, anonKey, supabaseUrl, issuer: `${supabaseUrl}/auth/v1` };
}

export async function readBdDotClaims(config: NonNullable<ReturnType<typeof bdDotConfig>>, token: string) {
  const supabase = createClient(config.supabaseUrl, config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await supabase.auth.getClaims(token);
  const claims = data?.claims;
  const now = Math.floor(Date.now() / 1000);
  if (error || !claims || claims.iss !== config.issuer || claims.aud !== "authenticated" ||
      claims.role !== "authenticated" || claims.sub !== config.subject ||
      claims.client_id !== config.clientId || typeof claims.session_id !== "string" ||
      !Number.isSafeInteger(claims.iat) || claims.iat > now ||
      !Number.isSafeInteger(claims.exp) || claims.exp <= now) {
    return null;
  }
  return claims;
}
