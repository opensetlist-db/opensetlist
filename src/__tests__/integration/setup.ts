import { config } from "dotenv";

// Same precedence as Next: `.env.local` overrides `.env`. Loaded before
// any test module imports `@/lib/prisma`, which reads DATABASE_URL at
// import time.
config({ path: [".env.local", ".env"], quiet: true });

// Guard rail: these suites write (and then delete) rows and emit
// broadcasts. Refuse to run against anything that is not the dev
// project. The check parses the URL and looks at the place Supabase
// actually puts the project ref, rather than `includes(ref)` over the
// whole string — a password or query string that happened to contain
// the dev ref would otherwise let a prod URL through:
//   direct:  postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres
//   pooler:  postgresql://postgres.<ref>:<pw>@<region>.pooler.supabase.com:6543/postgres
// Any URL that does not parse fails closed.
const DEV_PROJECT_REF = "nddawybyuedsrshhxikx";
function pointsAtDevProject(raw: string): boolean {
  let url: URL;
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
for (const name of ["DATABASE_URL", "DATABASE_URL_UNPOOLED"] as const) {
  if (!pointsAtDevProject(process.env[name] ?? "")) {
    throw new Error(
      `[integration] ${name} does not point at the dev Supabase project; refusing to run`,
    );
  }
}
