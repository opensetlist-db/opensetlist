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
