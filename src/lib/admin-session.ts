// Admin session token — shared by `src/proxy.ts` (request gate for
// `/api/admin/*`) and `src/lib/admin-auth.ts` (page/route helpers).
//
// The session cookie used to hold a fixed string that was committed to this
// public repo, so anyone who read the source could mint a valid admin cookie
// without the password. The token is now an HMAC-SHA256 of a fixed label
// keyed by a server-only secret:
//
//   ADMIN_SESSION_SECRET  — preferred; rotate it to log every session out
//   ADMIN_PASSWORD        — fallback so the fix needs no new env var; a
//                           password change also invalidates old sessions
//
// No secret configured → no token is valid (fail closed).
//
// Web Crypto only (no `node:crypto`, no `next/headers`) so the same code runs
// in the proxy and in route handlers / server components.

export const COOKIE_NAME = "admin_session";

// Versioned label: bump it to invalidate every outstanding session without
// touching the secret.
const SESSION_LABEL = "opensetlist-admin-session-v2";

function secret(): string | null {
  return process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD || null;
}

/** The cookie value a valid admin session must carry, or null if no secret is set. */
export async function adminSessionToken(): Promise<string | null> {
  const key = secret();
  if (!key) return null;
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(SESSION_LABEL));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time string comparison (avoids leaking the token via timing). */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** True when `cookieValue` is the current admin session token. */
export async function isValidAdminSession(cookieValue: string | undefined | null): Promise<boolean> {
  if (!cookieValue) return false;
  const expected = await adminSessionToken();
  if (!expected) return false;
  return safeEqual(cookieValue, expected);
}
