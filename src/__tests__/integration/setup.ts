import { config } from "dotenv";
import { DEV_PROJECT_REF, pointsAtDevProject } from "../../../scripts/dev-db-guard.mjs";

export { DEV_PROJECT_REF };

// Same precedence as Next: `.env.local` overrides `.env`. Loaded before
// any test module imports `@/lib/prisma`, which reads DATABASE_URL at
// import time.
config({ path: [".env.local", ".env"], quiet: true });

// Guard rail: these suites write (and then delete) rows and emit
// broadcasts. Refuse to run against anything that is not the dev
// project. The parsing rule (which part of the URL carries the project
// ref, and why) lives in scripts/dev-db-guard.mjs, shared with
// scripts/db-ro.mjs.
for (const name of ["DATABASE_URL", "DATABASE_URL_UNPOOLED"] as const) {
  if (!pointsAtDevProject(process.env[name] ?? "")) {
    throw new Error(
      `[integration] ${name} does not point at the dev Supabase project; refusing to run`,
    );
  }
}
