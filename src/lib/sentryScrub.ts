/**
 * Removes the browser anon id from everything sent to Sentry.
 *
 * Why: the anon id (`opensetlist_anon_id`, `src/lib/anonId.ts`) is a
 * bearer credential — whoever holds it can add/remove that browser's
 * fan board picks and edit its impressions. Sentry's default filtering
 * (with `sendDefaultPii: false`) does NOT cover it on every path: error
 * events keep request headers and JSON bodies, trace attributes keep
 * any header whose name isn't credential-shaped, and fetch breadcrumbs
 * keep URLs (older clients and other surfaces may still put the id in a
 * query string). So every Sentry hook in this app runs events, spans
 * and breadcrumbs through `scrubAnon` before they leave the process.
 *
 * What is masked, wherever it appears in the payload:
 *   - any object key that names the id or its header
 *     (`anonId`, `anon_id`, `opensetlist-anon-token`, and attribute
 *     keys that END with the header name, e.g.
 *     `http.request.header.opensetlist-anon-token`)
 *   - the value of a `[key, value]` pair whose key names the id —
 *     Sentry's tuple-array `request.query_string` shape, where the key
 *     is a string element, not an object key
 *   - inside strings: `anonId=<value>` (URLs, query strings, form
 *     bodies) and `"anonId":"<value>"` (JSON bodies captured as text)
 *
 * Mutates in place and returns the same value (Sentry hooks return the
 * event they were given); cycles and non-plain objects are tolerated.
 * Read-only slots (getter-only accessors, frozen objects/arrays) are
 * skipped rather than thrown on: Sentry payloads can reference live
 * objects — span data on a page render carries one with a getter-only
 * `$` — and a throw inside `beforeSend*` drops the whole event and is
 * itself reported as an unhandled error, once per sampled request.
 * Pure — no Sentry import — so it is unit-tested without the SDK.
 */

export const FILTERED = "[Filtered]";

const SENSITIVE_KEY =
  /(^|[._-])(anon[_-]?id|opensetlist[_-]anon[_-]token)$/i;

const IN_STRING: readonly [RegExp, string][] = [
  // query strings / form bodies / URLs: anonId=<value>
  [/(\banon[_-]?id=)[^&#\s"']*/gi, `$1${FILTERED}`],
  // JSON text: "anonId":"<value>"
  [/("anon[_-]?id"\s*:\s*")[^"]*(")/gi, `$1${FILTERED}$2`],
];

function scrubString(s: string): string {
  // Cheap guard: almost every string has no "anon" in it.
  if (!/anon/i.test(s)) return s;
  let out = s;
  for (const [re, rep] of IN_STRING) out = out.replace(re, rep);
  return out;
}

const MAX_DEPTH = 32;

// Writes only when the value actually changed (the walk mutates nested
// objects in place, so most slots come back identical and need no
// write), and never throws: `Reflect.set` answers false for a
// getter-only or non-writable slot instead of raising a TypeError the
// way a strict-mode assignment does. The try covers Proxies whose `set`
// trap throws. A slot we cannot write keeps its value — such slots hold
// SDK/runtime objects, not the request data the id travels in.
function assign(target: object, key: PropertyKey, prev: unknown, next: unknown) {
  if (next === prev) return;
  try {
    Reflect.set(target, key, next);
  } catch {
    // unwritable — leave as is
  }
}

export function scrubAnon<T>(value: T): T {
  const seen = new WeakSet<object>();
  const walk = (v: unknown, depth: number): unknown => {
    if (typeof v === "string") return scrubString(v);
    if (v === null || typeof v !== "object" || depth > MAX_DEPTH) return v;
    if (seen.has(v)) return v;
    seen.add(v);
    if (Array.isArray(v)) {
      if (v.length === 2 && typeof v[0] === "string" && SENSITIVE_KEY.test(v[0])) {
        assign(v, 1, v[1], FILTERED);
        return v;
      }
      for (let i = 0; i < v.length; i++) assign(v, i, v[i], walk(v[i], depth + 1));
      return v;
    }
    const rec = v as Record<string, unknown>;
    for (const key of Object.keys(rec)) {
      const prev = rec[key];
      assign(
        rec,
        key,
        prev,
        SENSITIVE_KEY.test(key) ? FILTERED : walk(prev, depth + 1),
      );
    }
    return v;
  };
  return walk(value, 0) as T;
}
