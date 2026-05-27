import { config } from "dotenv";
import path from "path";

/*
 * Side-effect-only module that loads .env then .env.local from the
 * repo root, mirroring Next.js's env precedence. Import this BEFORE
 * anything that reaches for process.env at module-eval time (the
 * PrismaPg adapter constructor in helpers/db.ts is the concrete
 * caller — it reads DATABASE_URL during its `new PrismaPg(...)`
 * call, so the env values must be in process.env before that line
 * executes).
 *
 * Kept as its own module so the side-effect runs before any other
 * import that depends on it — `import "./env";` at the top of a
 * consumer is the single line that guarantees the order.
 */
config({ path: path.resolve(__dirname, "../../../.env") });
config({
  path: path.resolve(__dirname, "../../../.env.local"),
  override: true,
});
