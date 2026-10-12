// Pure helpers for viewers.js's admission mode (`ADMISSION=1`, n14
// qualification step 5 — A1). Plain ESM with NO runtime imports, so
// both k6 (goja, which loads it from viewers.js) and Node (the unit
// tests in tests/load/admission-k6.test.mjs) can import it — viewers.js
// itself cannot run under Node (it imports k6/* modules).

// SHAPE_MIX "60/25/15" → { r2: 0.6, r1: 0.25, pre: 0.15 }: the share of
// admitted viewers per client build, in the order R2 / R1 / pre-R1.
// Parts are weights (normalised), so "6/2.5/1.5" means the same. Any
// non-numeric, negative or all-zero mix is refused: a typo must not
// quietly run a different experiment.
export function parseShapeMix(raw) {
  const parts = String(raw ?? "").split("/").map((s) => s.trim());
  if (parts.length !== 3 || parts.some((p) => p === "" || !/^\d+(\.\d+)?$/.test(p))) {
    throw new Error(`SHAPE_MIX must be three non-negative numbers "r2/r1/pre" (e.g. 60/25/15), got "${raw}"`);
  }
  const w = parts.map(Number);
  const sum = w[0] + w[1] + w[2];
  if (!(sum > 0)) throw new Error(`SHAPE_MIX must not be all zero, got "${raw}"`);
  return { r2: w[0] / sum, r1: w[1] / sum, pre: w[2] / sum };
}

export const SHAPES = ["r2", "r1", "pre"];

// One viewer's client build from a uniform draw u ∈ [0, 1). A shape is a
// property of the viewer (a tab keeps its build), so it is drawn once,
// at admission, and reused on every save.
export function pickShape(mix, u) {
  if (u < mix.r2) return "r2";
  if (u < mix.r2 + mix.r1) return "r1";
  return mix.pre > 0 ? "pre" : mix.r1 > 0 ? "r1" : "r2";
}

// ADMISSION_SAVES "5,20" → [5, 20] (seconds after t=0). Sorted, unique,
// positive; empty string = no saves (an admission wave without edits).
export function parseSaves(raw) {
  const s = String(raw ?? "").trim();
  if (s === "") return [];
  const out = s.split(",").map((x) => x.trim());
  if (out.some((x) => !/^\d+(\.\d+)?$/.test(x))) throw new Error(`ADMISSION_SAVES must be comma-separated seconds (e.g. 5,20), got "${raw}"`);
  const n = [...new Set(out.map(Number))].sort((a, b) => a - b);
  if (n.some((x) => x <= 0)) throw new Error(`ADMISSION_SAVES must be > 0 s, got "${raw}"`);
  return n;
}

// Scheduled start (ms after t=0) of arrival i of n, evenly spread over
// `seconds`: an open-loop arrival process, so a slow server cannot slow
// the arrivals down (each request's actual start is recorded against
// this schedule — "scheduled vs actual").
export function arrivalOffsetMs(i, n, seconds) {
  return n <= 0 ? 0 : (i * seconds * 1000) / n;
}

// The notification request of one admitted viewer on a save:
//   r2  — `minRev = savedRev & hint=1` (the R2 broadcast carries the
//         exact saved revision);
//   r1  — `minRev = appliedRev + 1`, no hint (the R1 page's guess from
//         the revision it last applied; savedRev − 1 + 1 when it never
//         applied one);
//   pre — no minRev at all (a pre-R1 tab), plus one repeat later.
export function notificationParams(shape, { savedRev, appliedRev }) {
  if (shape === "r2") return { minRev: savedRev, hint: true };
  if (shape === "r1") return { minRev: (appliedRev != null ? appliedRev : savedRev - 1) + 1, hint: false };
  if (shape === "pre") return { minRev: null, hint: false };
  throw new Error(`unknown shape ${shape}`);
}

// Saved-head checks for one response: `eq` = exactly the saved head,
// `ge` = at or beyond it. The per-shape claim (what is gated):
//   r2  — eq (it asked for exactly savedRev; a later save cannot have
//         committed within its window at the default 15 s spacing);
//   r1, pre — ge.
export function headCheck(shape, rev, savedRev) {
  const eq = rev != null && savedRev != null && rev === savedRev;
  const ge = rev != null && savedRev != null && rev >= savedRev;
  return { eq, ge, claim: shape === "r2" ? eq : ge };
}

// Exposure evidence at one instant of the admission VU: admitted =
// viewers with a 200 initial read; outstanding = arrivals not yet
// answered (scheduled-but-unsent + in flight); inFlight = this VU's open
// HTTP requests of any kind (arrivals, notification fetches, the PUT).
export function exposure({ admitted, arrivalsTotal, arrivalsDone, inFlight }) {
  return { admitted, outstanding: Math.max(0, arrivalsTotal - arrivalsDone), inFlight };
}

// Nearest-rank percentile on an ascending-sorted array (same as
// tests/load/realtime/lib.mjs `pct`).
export function pct(sorted, p) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
}
