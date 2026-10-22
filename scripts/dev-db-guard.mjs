// The one rule for "does this connection string point at the DEV
// Supabase project?", shared by everything that must never touch prod:
// the integration-test setup (which writes) and scripts/db-ro.mjs (which
// only reads, but the prod DB is off limits locally all the same).
//
// The check parses the URL and looks at the place Supabase actually puts
// the project ref, rather than `includes(ref)` over the whole string — a
// password or query string that happened to contain the dev ref would
// otherwise let a prod URL through:
//   direct:  postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres
//   pooler:  postgresql://postgres.<ref>:<pw>@<region>.pooler.supabase.com:6543/postgres
// Any URL that does not parse fails closed.
//
// Plain JS (typed by dev-db-guard.d.mts) so a bare `node scripts/…` can
// import it without a TypeScript loader.

import { execFileSync } from "node:child_process";
import path from "node:path";

export const DEV_PROJECT_REF = "nddawybyuedsrshhxikx";

/**
 * @param {string} raw
 * @returns {boolean}
 */
export function pointsAtDevProject(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  const direct = url.hostname === `db.${DEV_PROJECT_REF}.supabase.co`;
  const pooler =
    url.hostname.endsWith(".pooler.supabase.com") &&
    decodeURIComponent(url.username) === `postgres.${DEV_PROJECT_REF}`;
  return direct || pooler;
}

/**
 * The checkout whose `.env.local` / `.env` a DB script reads: the git
 * top level of the cwd, else `fallback` (the script-relative repo root).
 *
 * Script-relative alone breaks for the copies redesign worktrees extract
 * into the gitignored `.claude/tmp/`: `<script dir>/..` is `.claude/`
 * there, which holds no env, and the run stops on a missing
 * DATABASE_URL_UNPOOLED. page-qa / admin-qa / redesign-capture pick
 * their checkout the same way (scripts/page-qa/harness.mjs). Callers
 * print the result first, so a run started from the wrong directory
 * shows it.
 * @param {string} fallback
 * @returns {string}
 */
export function checkoutRoot(fallback) {
  try {
    const top = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (top) return path.resolve(top);
  } catch {
    // not in a work tree, or git missing
  }
  return fallback;
}
