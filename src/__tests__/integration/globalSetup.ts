import { execSync } from "child_process";

// Regenerate the Prisma client before the suites import it. The
// generated client (`src/generated/prisma`) is git-ignored and only
// refreshed by `postinstall`, so a worktree whose branch moved since the
// last install runs against a client built from an older schema: a
// column added on dev is unknown to it, writers that touch that column
// fail, and the failure reads like a database problem. Generating takes
// a second or two and needs no database connection.
export default function setup(): void {
  execSync("npx prisma generate", { stdio: "pipe" });
}
