"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Lazy module-scope singleton. Created on first call, reused for the rest of
// the session. We deliberately defer construction (vs a top-level `const`) so
// the module import does NOT throw when the env vars are missing — the
// realtime path is gated by `LAUNCH_FLAGS.realtimeEnabled`, and a polling-only
// build that doesn't set the Supabase env vars must still load cleanly.
//
// Why a singleton: the `supabase-js` client opens a long-lived WebSocket on
// first `.channel()` use. Recreating it per render would leak connections
// and re-issue subscriptions; a single instance per browser session is the
// supported pattern.
let cachedClient: SupabaseClient | null = null;

/**
 * Browser-only Supabase client used by the Realtime push subscription path.
 * Reads `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` from
 * the environment — both must be present (the `NEXT_PUBLIC_` prefix is
 * required for `next` to inline them into the client bundle).
 *
 * Throws if the env vars are missing. Callers should only invoke this
 * inside a `LAUNCH_FLAGS.realtimeEnabled === true` branch — when the flag
 * is off, the polling path runs and this function is never reached.
 */
export function getSupabaseBrowserClient(): SupabaseClient {
  if (cachedClient) return cachedClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Supabase Realtime client requires NEXT_PUBLIC_SUPABASE_URL and " +
        "NEXT_PUBLIC_SUPABASE_ANON_KEY env vars. Set them in `.env.local` " +
        "(local dev) and Vercel project settings (Preview + Production), " +
        "or flip `LAUNCH_FLAGS.realtimeEnabled` to `false` to keep the " +
        "polling fallback active.",
    );
  }

  cachedClient = createClient(url, anonKey, {
    // Anonymous browser session — we don't sign users into Supabase Auth
    // (Phase 1C is unauthenticated; channels stay public-read). Disabling
    // the auth-related background work avoids spurious refresh-token loops.
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  return cachedClient;
}
