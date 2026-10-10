import { config } from "dotenv";

// Same precedence as Next: `.env.local` overrides `.env`. Loaded before
// any test module imports `@/lib/prisma`, which reads DATABASE_URL at
// import time.
config({ path: [".env.local", ".env"], quiet: true });

// Guard rail: these suites write (and then delete) rows. Refuse to run
// against anything that is not the dev project.
const DEV_PROJECT_REF = "nddawybyuedsrshhxikx";
for (const name of ["DATABASE_URL", "DATABASE_URL_UNPOOLED"] as const) {
  const url = process.env[name] ?? "";
  if (!url.includes(DEV_PROJECT_REF)) {
    throw new Error(
      `[integration] ${name} does not point at the dev Supabase project; refusing to run`,
    );
  }
}
