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
 *   - inside strings: `anonId=<value>` (URLs, query strings, form
 *     bodies) and `"anonId":"<value>"` (JSON bodies captured as text)
 *
 * Mutates in place and returns the same value (Sentry hooks return the
 * event they were given); cycles and non-plain objects are tolerated.
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

export function scrubAnon<T>(value: T): T {
  const seen = new WeakSet<object>();
  const walk = (v: unknown, depth: number): unknown => {
    if (typeof v === "string") return scrubString(v);
    if (v === null || typeof v !== "object" || depth > MAX_DEPTH) return v;
    if (seen.has(v)) return v;
    seen.add(v);
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) v[i] = walk(v[i], depth + 1);
      return v;
    }
    const rec = v as Record<string, unknown>;
    for (const key of Object.keys(rec)) {
      rec[key] = SENSITIVE_KEY.test(key)
        ? FILTERED
        : walk(rec[key], depth + 1);
    }
    return v;
  };
  return walk(value, 0) as T;
}
