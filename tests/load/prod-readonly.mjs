// Production read-only guards (n14 qualification step 8), shared by
// observer.mjs --prod-readonly, wake-check.mjs and attribution-smoke.mjs.
//
// Why a separate module: every other tool in tests/load is dev-only and
// enforces it with the allow-lists in realtime/lib.mjs (dev alias /
// localhost for HTTP, the dev project ref for Supabase, the dev DB for
// SQL). Step 8 needs a few tools that can point at production — but only
// to LOOK: subscribe to the public `event:<id>` channel with the public
// anon key, GET the public snapshot endpoint, load public pages. Those
// tools invert the dev guard rather than drop it:
//
//   1. a production target is never a default: it must be asked for
//      with --prod-readonly (a mis-set BASE_URL or a copied command line
//      without the flag is refused, exactly as before);
//   2. in that mode only an explicit ALLOW-list of flags is accepted, so
//      a write-capable option borrowed from another harness command
//      (--admin, --save-offsets, --cleanup, --spam-rate, …) cannot ride
//      along — it is refused, and named, before anything touches the
//      network. The deny patterns below exist only to make the message
//      precise ("write-capable"); the allow-list is what enforces it;
//   3. the credential is the ANON key, proven from the key itself (JWT
//      `role` claim, or the `sb_publishable_` prefix of the new key
//      format) — a service-role / secret key is refused even if the
//      operator points --anon-key-env at it by mistake. The key value
//      and the project ref are never printed or written (masked).
//
// Nothing here opens a socket or reads a DB URL; every function is pure
// (covered by prod-readonly.test.mjs).
import { isAllowedBaseUrl, parseArgs } from "./realtime/lib.mjs";

export { parseArgs };

// Hosts a step-8 tool may target, by kind. "dev" = what every other tool
// already allows (localhost, the dev-branch alias); "prod" = the public
// domain; "deployment" = an immutable per-deployment URL of this
// project, which can be a production OR a preview deployment (it is the
// URL `vercel promote` / Instant Rollback act on, so the promotion drill
// needs it). Anything else (another project, a typo'd domain) is null.
export function classifyBase(raw) {
  let u;
  try { u = new URL(String(raw)); } catch { return null; }
  if (u.pathname !== "/" || u.search || u.hash || u.username || u.password) return null;
  if (isAllowedBaseUrl(u.origin)) return "dev";
  if (u.protocol !== "https:") return null;
  if (u.hostname === "opensetlist.com" || u.hostname === "www.opensetlist.com") return "prod";
  if (/^opensetlist-[a-z0-9]{6,12}-opensetlist-projects\.vercel\.app$/.test(u.hostname)) return "deployment";
  return null;
}

// Flag names other harness tools use for saves, logins, DB access, load
// or fault injection (grep of tests/load for args.* at the time of
// writing: admin, save-offsets, idle-saves, admission-saves,
// transition-saves, first-save-at/-file, cleanup, delete, restore-
// positions, edit-mode, publish, send, spam-*, poison-rev, drop*, drill,
// fixture, markers, anchor*, after-row, race, wake, load-rps, storms,
// private, topic, …) plus anything that smells of a credential. Matched
// against the flag NAME, case-insensitive.
const WRITE_FLAG_PATTERNS = [
  /admin/, /save/, /login/, /passw/, /secret/, /service/, /token/, /cookie/,
  /database/, /^db/, /sql/, /cleanup/, /delete/, /restore/, /edit/, /publish/,
  /^send/, /spam/, /poison/, /^drop/, /drill/, /fixture/, /marker/, /anchor/,
  /after-row/, /^race/, /^wake/, /load-rps/, /storm/, /^private/, /^topic/,
  /inject/, /fault/, /write/, /^put$/, /^post$/, /reaction/, /wish/,
];

export function isWriteishFlag(name) {
  const n = String(name).toLowerCase();
  return WRITE_FLAG_PATTERNS.some((re) => re.test(n));
}

// `args` from parseArgs; `allowed` the tool's own flag names. Returns the
// refusal messages (empty = fine). Positional arguments (no leading --)
// are refused too: parseArgs drops them silently, and a stray value is
// more likely a mistyped flag than intent.
export function refuseFlags(args, allowed, argv = []) {
  const errs = [];
  const allow = new Set(allowed);
  for (const k of Object.keys(args)) {
    if (allow.has(k)) continue;
    if (isWriteishFlag(k)) errs.push(`refusing: --${k} is a write-capable option; this tool is read-only in production mode`);
    else errs.push(`refusing: unknown flag --${k} (allowed: ${[...allow].map((a) => `--${a}`).join(" ")})`);
  }
  for (const a of argv) if (!/^--/.test(a)) errs.push(`refusing: unexpected argument "${String(a).slice(0, 40)}"`);
  return errs;
}

// `https://<ref>.supabase.co` → ref; anything else → null.
export function supabaseRefOf(raw) {
  let u;
  try { u = new URL(String(raw)); } catch { return null; }
  if (u.protocol !== "https:" || u.pathname !== "/" || u.search || u.username || u.password) return null;
  const m = /^([a-z0-9]{20})\.supabase\.co$/.exec(u.hostname);
  return m ? m[1] : null;
}

// For logs and reports: enough to tell dev from prod at a glance, not
// the whole ref.
export const maskRef = (ref) => (ref ? `${String(ref).slice(0, 4)}…` : "–");

// What kind of Supabase key this is, from the key alone:
//   legacy JWT → { kind: "jwt", role, ref } (payload decoded, NOT
//     verified — this is a foot-gun check, not authentication);
//   sb_publishable_… → { kind: "publishable", role: "anon" };
//   sb_secret_… → { kind: "secret", role: "service_role" };
//   anything else → { kind: "unknown", role: null }.
export function keyInfo(key) {
  const k = String(key || "");
  if (k.startsWith("sb_publishable_")) return { kind: "publishable", role: "anon", ref: null };
  if (k.startsWith("sb_secret_")) return { kind: "secret", role: "service_role", ref: null };
  const parts = k.split(".");
  if (parts.length === 3 && k.startsWith("eyJ")) {
    try {
      const p = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
      return { kind: "jwt", role: typeof p.role === "string" ? p.role : null, ref: typeof p.ref === "string" ? p.ref : null };
    } catch { /* fall through */ }
  }
  return { kind: "unknown", role: null, ref: null };
}

// Env var NAME for --anon-key-env: a plain identifier that does not name
// a privileged secret (the value is checked separately by keyInfo).
export function checkAnonKeyEnvName(name) {
  if (typeof name !== "string" || !/^[A-Z_][A-Z0-9_]*$/.test(name)) return "--anon-key-env must name an environment variable (e.g. PROD_SUPABASE_ANON_KEY)";
  if (/SERVICE|SECRET|PASSWORD|DATABASE|DB_URL|ADMIN/.test(name)) return `refusing: --anon-key-env=${name} names a privileged secret, not the anon key`;
  return null;
}

// --event-id: a positive integer, required (no default in a production
// mode — the dev default 111 is a different event in production).
export function checkEventId(v) {
  if (v === undefined || v === true) return "--event-id=<n> is required";
  return /^[1-9]\d{0,9}$/.test(String(v)) ? null : "--event-id must be a positive integer";
}

const LOCALES = new Set(["ja", "ko", "en", "zh-CN"]);
export function parseLocales(v, fallback = ["ja", "ko", "en"]) {
  if (v === undefined) return { locales: fallback, error: null };
  const list = String(v).split(",").map((s) => s.trim()).filter(Boolean);
  const bad = list.filter((l) => !LOCALES.has(l));
  if (!list.length || bad.length) return { locales: null, error: `--locales must be a comma list of ${[...LOCALES].join("/")}` };
  return { locales: [...new Set(list)], error: null };
}

// ─── observer.mjs --prod-readonly ───

export const OBSERVER_PROD_FLAGS = [
  "prod-readonly", "base", "event-id", "supabase-url", "anon-key-env",
  "listeners", "duration-s", "stop-file", "out", "label", "locales", "add-listener-after-s",
];

// Validates the whole command line and the key it names. `env` is the
// process environment (or a test double). Returns { errors, config };
// config is null whenever errors is non-empty. The config carries the
// key VALUE for the runner, but nothing derived from it is ever logged
// except keyInfo's kind/role.
export function validateObserverProd(args, env, argv = []) {
  const errors = [];
  if (args["prod-readonly"] !== true) errors.push("--prod-readonly takes no value");
  errors.push(...refuseFlags(args, OBSERVER_PROD_FLAGS, argv));
  const baseKind = classifyBase(args.base);
  if (!args.base || args.base === true) errors.push("--base=<origin> is required (https://opensetlist.com, a deployment URL, or the dev alias)");
  else if (!baseKind) errors.push("refusing: --base is not opensetlist.com, a deployment URL of this project, the dev alias or localhost");
  const ev = checkEventId(args["event-id"]);
  if (ev) errors.push(ev);
  const ref = supabaseRefOf(args["supabase-url"]);
  if (!ref) errors.push("--supabase-url=https://<project ref>.supabase.co is required");
  const nameErr = checkAnonKeyEnvName(args["anon-key-env"]);
  let key = null;
  if (nameErr) errors.push(nameErr);
  else {
    key = env[args["anon-key-env"]] || "";
    if (!key) errors.push(`environment variable ${args["anon-key-env"]} is empty or unset`);
    else {
      const info = keyInfo(key);
      if (info.role !== "anon") {
        errors.push(info.kind === "unknown"
          ? `refusing: ${args["anon-key-env"]} is not a recognisable Supabase anon key (JWT with role=anon, or sb_publishable_…)`
          : `refusing: ${args["anon-key-env"]} is a ${info.role ?? "non-anon"} key — only the anon (publishable) key is allowed`);
      } else if (info.ref && ref && info.ref !== ref) {
        errors.push(`refusing: ${args["anon-key-env"]} belongs to a different project than --supabase-url`);
      }
    }
  }
  const listeners = args.listeners === undefined ? 3 : Number(args.listeners);
  if (!Number.isInteger(listeners) || listeners < 1 || listeners > 10) errors.push("--listeners must be 1..10");
  const durationS = args["duration-s"] === undefined ? 900 : Number(args["duration-s"]);
  if (!(Number.isFinite(durationS) && durationS > 0 && durationS <= 4 * 3600)) errors.push("--duration-s must be in (0, 14400]");
  // One fresh listener spawned this far into the run (the "a listener
  // that joined after the first save gets the second" check). Must fall
  // inside the window, or it never starts.
  let addListenerAfterS = null;
  if (args["add-listener-after-s"] !== undefined) {
    addListenerAfterS = Number(args["add-listener-after-s"]);
    if (!(Number.isFinite(addListenerAfterS) && addListenerAfterS > 0 && addListenerAfterS < durationS)) errors.push("--add-listener-after-s must be in (0, --duration-s)");
  }
  const { locales, error: locErr } = parseLocales(args.locales);
  if (locErr) errors.push(locErr);
  if (args["stop-file"] === true || args.out === true || args.label === true) errors.push("--stop-file / --out / --label need a value");
  if (errors.length) return { errors, config: null };
  return {
    errors,
    config: {
      addListenerAfterS,
      base: new URL(String(args.base)).origin, baseKind, eventId: String(args["event-id"]),
      supabaseUrl: `https://${ref}.supabase.co`, supabaseRef: ref, anonKey: key, anonKeyEnv: args["anon-key-env"],
      keyKind: keyInfo(key).kind, listeners, durationS, locales,
      stopFile: args["stop-file"] ? String(args["stop-file"]) : null,
      out: args.out ? String(args.out) : null,
      label: args.label ? String(args.label).replace(/[^a-zA-Z0-9_-]/g, "_") : "",
    },
  };
}

// ─── wake-check.mjs ───

export const WAKE_CHECK_FLAGS = [
  "prod-readonly", "base", "event-id", "event-path", "locales", "pages", "wait-s",
  "deployment", "out", "label", "stop-file", "headed", "poll-only", "expect-saves",
];

// A non-dev base needs --prod-readonly (the tool is read-only either
// way; the flag is the "I mean production" acknowledgement).
export function validateWakeCheck(args, argv = []) {
  const errors = [];
  errors.push(...refuseFlags(args, WAKE_CHECK_FLAGS, argv));
  const prod = args["prod-readonly"] !== undefined;
  if (prod && args["prod-readonly"] !== true) errors.push("--prod-readonly takes no value");
  const baseKind = classifyBase(args.base);
  if (!args.base || args.base === true) errors.push("--base=<origin> is required");
  else if (!baseKind) errors.push("refusing: --base is not opensetlist.com, a deployment URL of this project, the dev alias or localhost");
  else if (baseKind !== "dev" && !prod) errors.push("refusing: --base is a production (or deployment) URL; pass --prod-readonly to target it explicitly");
  const ev = checkEventId(args["event-id"]);
  if (ev) errors.push(ev);
  let eventPath = null;
  if (args["event-path"] !== undefined) {
    eventPath = String(args["event-path"]);
    if (!/^\/events\/\d+(\/[a-z0-9-]+)?$/.test(eventPath)) errors.push("--event-path must look like /events/<id>[/<slug>]");
    else if (!ev && eventPath.split("/")[2] !== String(args["event-id"])) errors.push("--event-path names a different event than --event-id");
  } else if (!ev) {
    // The bare id 308-redirects to the canonical slug (entityUrl.ts), and
    // the browser follows it: no slug needs to be known in advance.
    eventPath = `/events/${args["event-id"]}`;
  }
  const { locales, error: locErr } = parseLocales(args.locales);
  if (locErr) errors.push(locErr);
  // Pages whose Realtime websocket is blocked (the poll-only repair
  // path). Default 1: the repair path is part of what a PASS means; 0 is
  // allowed but then that check (and the overall verdict) can only be
  // NOT EXERCISED.
  const pollOnly = args["poll-only"] === undefined ? 1 : Number(args["poll-only"]);
  if (!Number.isInteger(pollOnly) || pollOnly < 0 || pollOnly > 3) errors.push("--poll-only must be 0..3");
  // How many saves the operator will make (R1 = check save, R2 = the
  // "stays connected" save). Fewer observed → overall NOT EXERCISED.
  const expectSaves = args["expect-saves"] === undefined ? 2 : Number(args["expect-saves"]);
  if (!Number.isInteger(expectSaves) || expectSaves < 1 || expectSaves > 2) errors.push("--expect-saves must be 1 or 2");
  const pages = args.pages === undefined ? 2 : Number(args.pages);
  if (!Number.isInteger(pages) || pages < 1 || pages > 5) errors.push("--pages (per locale) must be 1..5");
  const waitS = args["wait-s"] === undefined ? 600 : Number(args["wait-s"]);
  if (!(Number.isFinite(waitS) && waitS > 0 && waitS <= 4 * 3600)) errors.push("--wait-s must be in (0, 14400]");
  let deployment = null;
  if (args.deployment !== undefined) {
    deployment = String(args.deployment);
    if (!/^dpl_[A-Za-z0-9]+$/.test(deployment) && classifyBase(deployment) !== "deployment") errors.push("--deployment must be a dpl_… id or a deployment URL of this project");
  }
  if (args["stop-file"] === true || args.out === true || args.label === true) errors.push("--stop-file / --out / --label need a value");
  if (errors.length) return { errors, config: null };
  return {
    errors,
    config: {
      base: new URL(String(args.base)).origin, baseKind, prod, eventId: String(args["event-id"]), eventPath,
      locales, pages, pollOnly, expectSaves, waitS, deployment, headed: args.headed === true,
      stopFile: args["stop-file"] ? String(args["stop-file"]) : null,
      out: args.out ? String(args.out) : null,
      label: args.label ? String(args.label).replace(/[^a-zA-Z0-9_-]/g, "_") : "",
    },
  };
}

// ─── attribution-smoke.mjs ───

// The smoke's defaults (event 111 and its rehearsal slug) are DEV data.
// Against anything but the dev alias / localhost the event must be named
// explicitly, so a production run never silently measures a different
// (or nonexistent) event 111. Returns a refusal message or null.
export function attributionEventGuard({ base, eventId, eventPath }) {
  if (classifyBase(base) === "dev") return null;
  if (eventId === undefined || eventId === true) return "refusing: --base is not the dev alias / localhost — pass --event-id=<n> (the default 111 is a dev event)";
  if (!/^[1-9]\d{0,9}$/.test(String(eventId))) return "--event-id must be a positive integer";
  if (eventPath !== undefined && eventPath !== true && String(eventPath).split("/")[2] !== String(eventId)) return "refusing: --event-path names a different event than --event-id";
  return null;
}

// ─── transition-sampler.mjs ───

export const SAMPLER_FLAGS = [
  "prod-readonly", "base", "event-id", "path", "expect", "duration-s", "interval-ms",
  "out", "label", "stop-file",
];

// Both --event-id and --path are REQUIRED (no dev defaults to fall back
// on), and --path must be the canonical locale-prefixed path of that
// event, so the document samples hit one fixed URL — not a redirect hop
// whose own answer would hide which deployment rendered the page.
export function validateSampler(args, argv = []) {
  const errors = [];
  errors.push(...refuseFlags(args, SAMPLER_FLAGS, argv));
  const prod = args["prod-readonly"] !== undefined;
  if (prod && args["prod-readonly"] !== true) errors.push("--prod-readonly takes no value");
  const baseKind = classifyBase(args.base);
  if (!args.base || args.base === true) errors.push("--base=<origin> is required");
  else if (!baseKind) errors.push("refusing: --base is not opensetlist.com, a deployment URL of this project, the dev alias or localhost");
  else if (baseKind !== "dev" && !prod) errors.push("refusing: --base is a production (or deployment) URL; pass --prod-readonly to target it explicitly");
  const ev = checkEventId(args["event-id"]);
  if (ev) errors.push(ev);
  const p = args.path;
  if (p === undefined || p === true) errors.push("--path=/<locale>/events/<id>/<slug> is required (the canonical event path)");
  else if (!/^\/(ja|ko|en|zh-CN)\/events\/\d+\/[a-z0-9-]+$/.test(String(p))) errors.push("--path must be the canonical /<locale>/events/<id>/<slug>");
  else if (!ev && String(p).split("/")[3] !== String(args["event-id"])) errors.push("refusing: --path names a different event than --event-id");
  const expect = args.expect;
  if (expect === undefined || expect === true || !/^dpl_[A-Za-z0-9]+$/.test(String(expect))) errors.push("--expect=<dpl_… id of the deployment the switch goes TO> is required");
  const durationS = args["duration-s"] === undefined ? 300 : Number(args["duration-s"]);
  if (!(Number.isFinite(durationS) && durationS > 0 && durationS <= 1800)) errors.push("--duration-s must be in (0, 1800]");
  const intervalMs = args["interval-ms"] === undefined ? 250 : Number(args["interval-ms"]);
  if (!(Number.isInteger(intervalMs) && intervalMs >= 200 && intervalMs <= 5000)) errors.push("--interval-ms must be an integer in [200, 5000]");
  if (args["stop-file"] === true || args.out === true || args.label === true) errors.push("--stop-file / --out / --label need a value");
  if (errors.length) return { errors, config: null };
  return {
    errors,
    config: {
      base: new URL(String(args.base)).origin, baseKind, prod, eventId: String(args["event-id"]), path: String(p),
      expect: String(expect), durationS, intervalMs,
      stopFile: args["stop-file"] ? String(args["stop-file"]) : null,
      out: args.out ? String(args.out) : null,
      label: args.label ? String(args.label).replace(/[^a-zA-Z0-9_-]/g, "_") : "",
    },
  };
}
