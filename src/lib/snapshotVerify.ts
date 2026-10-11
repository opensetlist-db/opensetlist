/**
 * `x-snapshot-verify` — how the server resolved a request's `?minRev=`
 * hint, sent as a per-request response header by `GET /api/setlist`.
 *
 * This module is shared by the server (which formats the header) and
 * the live page's client code (which parses it), so it must stay pure:
 * no `node:` imports, no Prisma, nothing server-only.
 *
 * Wire values:
 *
 *   none                 the request carried no `minRev`
 *   satisfied            the served snapshot has `rev ≥ minRev` (first
 *                        cached read, or after a repair rebuild)
 *   fresh=<dbRev>        served `rev < minRev`, and THIS request started
 *                        a 1-row revision read that answered `dbRev`.
 *                        The read began after the request did, so when
 *                        `dbRev < minRev` the hint is disproved by fresh
 *                        evidence.
 *   memo=<rev>;age=<ms>  served `rev < minRev`, refuted only by older
 *                        evidence: the instance's remembered revision,
 *                        or a coalesced read this request joined (that
 *                        read's SELECT may have run before the announced
 *                        save committed). `age` = ms since that read
 *                        STARTED. Not proof — the client rechecks.
 *   deferred             served `rev < minRev`, and the revision read
 *                        timed out / failed (or a remembered failure is
 *                        still inside its window). Not proof.
 *
 * Revisions are emitted as decimal safe integers (the same domain as
 * the body's `rev`), so the client never needs BigInt to compare them.
 */

export const SNAPSHOT_VERIFY_HEADER = "x-snapshot-verify";

export type SnapshotVerify =
  | { kind: "none" }
  | { kind: "satisfied" }
  | { kind: "fresh"; dbRev: number }
  | { kind: "memo"; rev: number; ageMs: number }
  | { kind: "deferred" }
  /**
   * Parser-only: the header was absent (an older server, e.g. after a
   * rollback, or a non-200 response) or did not match the grammar
   * above. Both are inconclusive and must never be read as a
   * refutation. The server never formats this kind.
   */
  | { kind: "missing" };

/** The kinds the server can emit (everything but the parser's `missing`). */
export type ServerSnapshotVerify = Exclude<SnapshotVerify, { kind: "missing" }>;

// Same shape as the server's `minRev` grammar: decimal digits only, no
// sign / exponent / whitespace, and it must survive `Number` exactly.
function parseSafeUint(raw: string): number | null {
  if (!/^\d{1,16}$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

/** Wire form of a verification result (server side). */
export function formatSnapshotVerify(v: ServerSnapshotVerify): string {
  switch (v.kind) {
    case "none":
    case "satisfied":
    case "deferred":
      return v.kind;
    case "fresh":
      return `fresh=${v.dbRev}`;
    case "memo":
      return `memo=${v.rev};age=${v.ageMs}`;
  }
}

/**
 * Parse an `x-snapshot-verify` header value (client side). Strict:
 * anything that is not exactly one of the documented forms — including
 * a missing header — is `{ kind: "missing" }`, the inconclusive outcome.
 * Pass `response.headers.get(SNAPSHOT_VERIFY_HEADER)`.
 */
export function parseSnapshotVerify(headerValue: string | null): SnapshotVerify {
  if (headerValue === null) return { kind: "missing" };
  const v = headerValue.trim();
  if (v === "none" || v === "satisfied" || v === "deferred") return { kind: v };
  const fresh = /^fresh=(\d+)$/.exec(v);
  if (fresh) {
    const dbRev = parseSafeUint(fresh[1]);
    return dbRev === null ? { kind: "missing" } : { kind: "fresh", dbRev };
  }
  const memo = /^memo=(\d+);age=(\d+)$/.exec(v);
  if (memo) {
    const rev = parseSafeUint(memo[1]);
    const ageMs = parseSafeUint(memo[2]);
    return rev === null || ageMs === null
      ? { kind: "missing" }
      : { kind: "memo", rev, ageMs };
  }
  return { kind: "missing" };
}
