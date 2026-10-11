// `x-snapshot-verify` — the per-request verification metadata the
// `/api/setlist` route attaches to a snapshot response.
//
// Why a header and not a body field: the body is the CACHED snapshot,
// shared by every request that hits the same entry. Whether THIS
// request's `?minRev=` was satisfied, refuted by a fresh database read,
// or only refuted by an instance's remembered revision is a property of
// the request, so it must never be stored with the body.
//
// Wire format (one value per response; error responses carry none):
//
//   none                 the request had no `minRev`
//   satisfied            the served snapshot has rev ≥ minRev
//   fresh=<dbRev>        served rev < minRev, and a revision read that
//                        THIS request started returned dbRev < minRev —
//                        proof that no such revision existed after the
//                        request began
//   memo=<rev>;age=<ms>  served rev < minRev, refuted only by a
//                        remembered / coalesced revision read that may
//                        predate the announced save — not proof
//   deferred             served rev < minRev, the verification read
//                        timed out or failed
//
// The client treats anything it cannot parse exactly like an absent
// header (`missing`): a server from before this header existed (a
// rollback) or a proxy that mangled it. `missing` is never a refutation —
// the hint contract (snapshotAcceptance.ts) classifies it as
// inconclusive, which costs at most one quiet recheck.
//
// Pure: no server imports, so the client bundle can use it. The server
// side formats the same grammar; the two must stay in sync.

export const SNAPSHOT_VERIFY_HEADER = "x-snapshot-verify";

export type SnapshotVerify =
  | { kind: "none" }
  | { kind: "satisfied" }
  | { kind: "fresh"; dbRev: number }
  | { kind: "memo"; rev: number; ageMs: number }
  | { kind: "deferred" }
  | { kind: "missing" };

const MISSING: SnapshotVerify = { kind: "missing" };

/**
 * Digits only → a non-negative safe integer, else null. Stricter than
 * `Number()` on purpose: "", "1e3", "0x10", " 7" and "7.0" are all
 * malformed metadata, and malformed must read as `missing`, never as a
 * number that could refute a hint.
 */
function parseNonNegativeInt(text: string): number | null {
  if (!/^\d{1,16}$/.test(text)) return null;
  const n = Number(text);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * Parse one `x-snapshot-verify` header value. `null` (header absent),
 * an unknown token, or any malformed number → `{ kind: "missing" }`.
 * Surrounding whitespace is tolerated (HTTP header values may carry
 * optional whitespace); token case is not — the server emits lower case.
 */
export function parseSnapshotVerify(headerValue: string | null): SnapshotVerify {
  if (typeof headerValue !== "string") return MISSING;
  const value = headerValue.trim();
  if (value === "none") return { kind: "none" };
  if (value === "satisfied") return { kind: "satisfied" };
  if (value === "deferred") return { kind: "deferred" };

  if (value.startsWith("fresh=")) {
    const dbRev = parseNonNegativeInt(value.slice("fresh=".length));
    return dbRev === null ? MISSING : { kind: "fresh", dbRev };
  }

  if (value.startsWith("memo=")) {
    const parts = value.slice("memo=".length).split(";");
    if (parts.length !== 2 || !parts[1].startsWith("age=")) return MISSING;
    const rev = parseNonNegativeInt(parts[0]);
    const ageMs = parseNonNegativeInt(parts[1].slice("age=".length));
    if (rev === null || ageMs === null) return MISSING;
    return { kind: "memo", rev, ageMs };
  }

  return MISSING;
}
