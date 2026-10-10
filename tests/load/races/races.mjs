#!/usr/bin/env node
// n14 run #2 — cache races on the deployed dev preview.
//
//   node tests/load/races/races.mjs --race=all --scale=smoke
//   node tests/load/races/races.mjs --race=1,2 --scale=full
//   node tests/load/races/races.mjs --race=cleanup
//
// The invariant every race checks (spec "Run #2", third bullet):
//   a client that applies snapshots with the `(rev, capturedAt)`
//   acceptance rule and asks `?minRev=<its rev + 1>` after a
//   notification must converge to the committed state within the
//   client's repair period (≤ 24 s, the 20 s ± 4 s periodic fetch), and
//   must never apply a snapshot that goes backwards.
// Several races also check the stricter target the 3 s freshness
// requirement depends on (stale-after-purge ≤ the 2 s cache TTL; a
// `minRev` repair answered on the first try).
//
// Writes: ONE scratch row appended after event 111's last position (a
// real admin POST), then every "save" is a PUT on that row (a real
// setlist writer: lock → bump → broadcast → commit → expire
// `event:111`). The row is soft-deleted at the end, also on Ctrl-C.
// Race 6 inserts a throwaway Event directly with pg and hard-deletes it.
//
// Output: tests/load/results/<UTC date>/<stamp>-races.md (+ .json raw,
// gitignored). Each race is a section with what was done, the evidence
// table, PASS/FAIL, and suspected app bugs with file:line.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { parseArgs } from "../realtime/lib.mjs";
import {
  setup,
  sleep,
  now,
  snap,
  adminSession,
  db,
  closeDb,
  dbRev,
  visibleRows,
  leftoverRows,
  countBy,
  fmtCounts,
  snapTable,
  loadAcceptance,
  EVENT_ID,
  EXPECTED_BASE_ROWS,
} from "./lib.mjs";

const args = parseArgs(process.argv.slice(2));
const BASE = setup();
const SCALE = args.scale === "full" ? "full" : "smoke";

// Scale presets. `smoke` proves the plumbing in ~2 min with a handful
// of requests; `full` is what the orchestrator runs for the results.
const P = {
  smoke: {
    r1: { burst: 8, pollers: 2, pollSecs: 4, pollEveryMs: 500, saveDelays: [0] },
    r2: { offsets: [0, 200], k: 3, broadcast: true, backToBack: true },
    r3: { repeats: 1, idleMs: 3000 },
    r4: { conns: 22, sleepSecs: 8, tailSecs: 4 },
    r5: { throttles: [0, 900], delays: [0] },
    r6: { leadSecs: 20, afterSecs: 8, ssrEveryMs: 3000 },
  },
  full: {
    r1: { burst: 50, pollers: 3, pollSecs: 10, pollEveryMs: 250, saveDelays: [0, 100, 250] },
    r2: { offsets: [0, 50, 100, 200, 500], k: 10, broadcast: true, backToBack: true },
    r3: { repeats: 3, idleMs: 5000 },
    r4: { conns: 22, sleepSecs: 20, tailSecs: 8 },
    r5: { throttles: [0, 400, 900, 1500], delays: [0, 50, 100] },
    r6: { leadSecs: 30, afterSecs: 15, ssrEveryMs: 2000 },
  },
}[SCALE];
// Race 4's pool size depends on the Supavisor configuration of the day.
if (args["r4-conns"]) P.r4.conns = Number(args["r4-conns"]);
if (args["r4-secs"]) P.r4.sleepSecs = Number(args["r4-secs"]);

// The 2 s data-cache TTL of the snapshot (`SNAPSHOT_TTL_SECONDS` in
// src/lib/liveSnapshot.ts) — the strict staleness window race 1 checks.
const TTL_MS = 2000;
// The client's repair period: healthy-path periodic fetch 20 s ± 4 s.
const REPAIR_MS = 24000;

const ctx = { base: BASE, admin: null, cleanups: [] };

// ---------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------

/** Closed-loop pollers: each issues one request, waits for it, sleeps the rest of `everyMs`. */
async function pollUntil({ pollers, everyMs, until, locale = "ja", minRev = null, label = "poll" }) {
  const out = [];
  await Promise.all(
    Array.from({ length: pollers }, async (_, i) => {
      while (now() < until) {
        const t = now();
        out.push(await snap(BASE, { locale, minRev, label: `${label}${i}` }));
        const rest = everyMs - (now() - t);
        if (rest > 0) await sleep(rest);
      }
    }),
  );
  return out.sort((a, b) => a.sentAt - b.sentAt);
}

const many = (n, opts) => Array.from({ length: n }, (_, i) => snap(BASE, { ...opts, label: `${opts.label}${i}` }));

/** DB-clock instant the save's broadcast row was inserted (≈ its commit, a few ms earlier). */
async function saveDbTime(rev) {
  const r = await (await db()).query(
    `SELECT max(inserted_at) AS at FROM realtime.messages
      WHERE topic = $1 AND event = 'rev' AND (payload->>'rev')::bigint = $2`,
    [`event:${EVENT_ID}`, rev],
  );
  const at = r.rows[0]?.at;
  return at ? new Date(at).toISOString() : null;
}

function verdictLine(ok, text) {
  return `**${ok ? "PASS" : "FAIL"}** — ${text}`;
}

// ---------------------------------------------------------------------
// race 1 — commit during an in-flight build
// ---------------------------------------------------------------------

async function race1(p) {
  const admin = ctx.admin;
  const rounds = [];
  const evidence = [];
  for (const delay of p.saveDelays) {
    for (const mode of ["poll-no-minRev", "minRev-first-try"]) {
      // Cold start: one save purges `event:111`; wait for the purge to
      // land before the burst so the burst really builds.
      const pre = await admin.save();
      await sleep(1000);
      const t0 = now();
      const burstP = many(p.burst, { locale: "ja", label: "burst" });
      if (delay) await sleep(delay);
      const save = await admin.save();
      const r1 = save.rev;
      let after;
      if (mode === "poll-no-minRev") {
        after = await pollUntil({
          pollers: p.pollers,
          everyMs: p.pollEveryMs,
          until: save.ackAt + p.pollSecs * 1000,
          label: "poll",
        });
      } else {
        // The client got the notification at ack and asks for the new
        // revision once, from `pollers` independent clients at once.
        after = await Promise.all(many(p.pollers, { locale: "ja", minRev: r1, label: "minrev" }));
      }
      const burst = await Promise.all(burstP);
      const commitDb = await saveDbTime(r1);
      // A burst response built from a snapshot taken before the commit
      // and FINISHED after the ack is the in-flight-build case.
      const inflightOld = burst.filter((r) => r.rev !== null && r.rev < r1 && r.recvAt > save.ackAt);
      const staleAfterAck = after.filter((r) => r.rev !== null && r.rev < r1 && r.sentAt >= save.ackAt);
      const maxLag = staleAfterAck.length ? Math.max(...staleAfterAck.map((r) => r.sentAt - save.ackAt)) : null;
      const errors = [...burst, ...after].filter((r) => r.error || r.http !== 200);
      const lastAfter = after[after.length - 1];
      const round = {
        mode,
        delay,
        preRev: pre.rev,
        rev: r1,
        save: { sentAt: save.sentAt - t0, ackAt: save.ackAt - t0, ms: save.ms, commitDb },
        burst: { n: burst.length, revs: countBy(burst, "rev"), sources: countBy(burst, "source"), inflightOld: inflightOld.length },
        after: { n: after.length, revs: countBy(after, "rev"), sources: countBy(after, "source") },
        staleAfterAck: staleAfterAck.length,
        staleBeyondTtl: staleAfterAck.filter((r) => r.sentAt - save.ackAt > TTL_MS).length,
        maxStaleLagMs: maxLag,
        errors: errors.length,
        converged: mode === "poll-no-minRev" ? lastAfter?.rev >= r1 : after.every((r) => r.rev >= r1),
      };
      rounds.push(round);
      evidence.push(
        `#### delay ${delay} ms, ${mode} (pre-save rev ${pre.rev} → save rev ${r1}; ack at +${save.ackAt - t0} ms, commit ≈ ${commitDb} DB clock)\n\n` +
          snapTable([...burst, ...after].sort((a, b) => a.sentAt - b.sentAt), {
            t0,
            extra: [["stale?", (r) => (r.rev !== null && r.rev < r1 ? (r.sentAt >= save.ackAt ? `STALE +${r.sentAt - save.ackAt}` : "old (sent pre-ack)") : "")]],
          }),
      );
      await sleep(2500);
    }
  }
  const pollRounds = rounds.filter((r) => r.mode === "poll-no-minRev");
  const minRounds = rounds.filter((r) => r.mode === "minRev-first-try");
  const strictOk = pollRounds.every((r) => r.staleBeyondTtl === 0);
  const firstTryOk = minRounds.every((r) => r.converged);
  const convergedOk = rounds.every((r) => r.converged);
  const summary = [
    "| delay | mode | pre→rev | burst revs | burst sources | in-flight old (recv after ack) | after revs | after sources | stale after ack | stale > 2 s | max stale lag ms | errors | converged |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|",
    ...rounds.map(
      (r) =>
        `| ${r.delay} | ${r.mode} | ${r.preRev}→${r.rev} | ${fmtCounts(r.burst.revs)} | ${fmtCounts(r.burst.sources)} | ${r.burst.inflightOld} | ${fmtCounts(r.after.revs)} | ${fmtCounts(r.after.sources)} | ${r.staleAfterAck} | ${r.staleBeyondTtl} | ${r.maxStaleLagMs ?? "—"} | ${r.errors} | ${r.converged ? "yes" : "NO"} |`,
    ),
  ].join("\n");
  return {
    title: "1. Commit during an in-flight build",
    what:
      `Per round: one save to purge \`event:111\` (cold), 1 s settle, then ${p.burst} parallel \`GET /api/setlist?eventId=111&locale=ja\` and — ${p.saveDelays.join("/")} ms after the burst started — an admin save (PUT on the scratch row). ` +
      `Mode \`poll-no-minRev\`: from the save's ack, ${p.pollers} closed-loop pollers every ${p.pollEveryMs} ms for ${p.pollSecs} s without \`minRev\`; a response is *stale* if it was SENT after the ack and carries \`rev\` < the save's rev. ` +
      `Mode \`minRev-first-try\`: at the ack, ${p.pollers} parallel requests with \`minRev=<new rev>\`; each must return the new rev on the first try.`,
    verdict:
      verdictLine(strictOk && firstTryOk && convergedOk, `stale responses sent > ${TTL_MS} ms after the ack: ${pollRounds.reduce((a, r) => a + r.staleBeyondTtl, 0)}; minRev first-try at new rev: ${minRounds.filter((r) => r.converged).length}/${minRounds.length} rounds; converged by end of round: ${rounds.filter((r) => r.converged).length}/${rounds.length}.`),
    ok: strictOk && firstTryOk && convergedOk,
    suspects: [
      ...(strictOk
        ? []
        : [
            "Stale entry outlived the save's purge by more than the 2 s TTL. Candidates: a build whose REPEATABLE READ snapshot predates the commit stores its old value into the `event-live-snapshot` entry AFTER `revalidateTag` ran (src/lib/liveSnapshot.ts:320-325 via src/lib/dataCache.ts:184 `unstable_cache`, `revalidate: 2` = stale-while-revalidate), or the purge reached the serving instance late. Repro: the `poll-no-minRev` round(s) above with stale > 2 s — burst of cold GETs + one save, then poll without minRev.",
          ]),
      ...(firstTryOk
        ? []
        : [
            "A `minRev=<committed rev>` request sent at the save's ack came back older than that rev: the repair check (src/lib/liveSnapshot.ts:474-488) answered from a remembered or coalesced read instead of the DB. Repro: the `minRev-first-try` round(s) above.",
          ]),
    ],
    summary,
    evidence,
    raw: rounds,
  };
}

// ---------------------------------------------------------------------
// race 2 — notification before the tag purge propagates
// ---------------------------------------------------------------------

async function race2(p) {
  const admin = ctx.admin;
  const groups = [];
  const evidence = [];

  const record = (variant, rev, recs, extra = {}) => {
    // Against what each request ASKED for (= a committed revision), not
    // against our save's rev: a foreign save in between can make the two
    // differ (the broadcast trigger fires on whichever revision arrives).
    const behind = recs.filter((r) => r.rev !== null && r.minRev !== null && r.rev < r.minRev);
    groups.push({
      variant,
      rev,
      n: recs.length,
      behind: behind.length,
      behindSources: countBy(behind, "source"),
      sources: countBy(recs, "source"),
      revs: countBy(recs, "rev"),
      errors: recs.filter((r) => r.error || r.http !== 200).length,
      ...extra,
    });
  };

  for (const offset of p.offsets) {
    await snap(BASE, { locale: "ja", label: "warm" }); // a fresh entry at the old rev
    const s = await admin.save();
    if (offset) await sleep(offset);
    const recs = await Promise.all(many(p.k, { locale: "ja", minRev: s.rev, label: `ack+${offset}` }));
    record(`ack + ${offset} ms`, s.rev, recs);
    evidence.push(`#### ack + ${offset} ms (save rev ${s.rev}, ack at ${s.ackAt})\n\n` + snapTable(recs, { t0: s.ackAt }));
    await sleep(2500);
  }

  if (p.broadcast) {
    // The real R2 trigger: the Realtime broadcast, which leaves the DB
    // on commit (WAL) and can reach a client BEFORE the admin's HTTP
    // response — and before the `revalidateTag` that runs after the
    // handler returns. Fire the minRev requests on receipt.
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const ch = sb.channel(`event:${EVENT_ID}`, { config: { private: false } });
    let fire = null;
    ch.on("broadcast", { event: "rev" }, (m) => fire?.(m.payload));
    const subscribed = await new Promise((resolve) => {
      ch.subscribe((st) => st === "SUBSCRIBED" && resolve(true));
      setTimeout(() => resolve(false), 10000);
    });
    if (!subscribed) {
      groups.push({ variant: "on broadcast", error: "channel did not reach SUBSCRIBED in 10 s" });
    } else {
      await snap(BASE, { locale: "ja", label: "warm" });
      const expected = (await dbRev()) + 1;
      let bcastAt = null;
      let bcastRev = null;
      // Fires on the first broadcast at or past the revision our save
      // will get. Alone on the event that IS our save; with foreign
      // writers it may be theirs (recorded as bcastRev) — either way the
      // requests ask for a revision that has committed.
      const fired = new Promise((resolve) => {
        fire = (payload) => {
          if (!(payload?.rev >= expected) || bcastAt !== null) return;
          bcastAt = now();
          bcastRev = payload.rev;
          resolve(Promise.all(many(p.k, { locale: "ja", minRev: payload.rev, label: "bcast" })));
        };
        setTimeout(() => resolve([]), 15000);
      });
      const s = await admin.save();
      const recs = await fired;
      record("on broadcast receipt", s.rev, recs, { bcastMinusAckMs: bcastAt === null ? null : bcastAt - s.ackAt });
      evidence.push(
        `#### on broadcast receipt (save rev ${s.rev}; broadcast rev ${bcastRev ?? "—"} received ${bcastAt === null ? "NEVER" : `${bcastAt - s.ackAt} ms relative to the HTTP ack`})\n\n` +
          snapTable(recs, { t0: s.ackAt }),
      );
    }
    await sb.removeAllChannels();
    await sleep(2500);
  }

  if (p.backToBack) {
    // Two saves ~one round-trip apart. The first save's minRev requests
    // make the instances read the DB revision (`verifiedRevision`), which
    // is then remembered for REV_MEMO_MS = 1 s. If the second save's
    // minRev requests reach an instance whose cached read is still the
    // old entry (purge not applied yet, or a coalesced in-flight read),
    // the memo — not the DB — answers the repair check.
    await snap(BASE, { locale: "ja", label: "warm" });
    const s1 = await admin.save();
    const first = Promise.all(many(p.k, { locale: "ja", minRev: s1.rev, label: "b2b-1st" }));
    const s2 = await admin.save();
    const second = await Promise.all(many(p.k, { locale: "ja", minRev: s2.rev, label: "b2b-2nd" }));
    const firstRecs = await first;
    record("back-to-back: 1st save", s1.rev, firstRecs);
    record("back-to-back: 2nd save", s2.rev, second, { gapMs: s2.ackAt - s1.ackAt });
    evidence.push(
      `#### back-to-back saves (rev ${s1.rev} ack ${s1.ackAt}, rev ${s2.rev} ack ${s2.ackAt}; times relative to the 1st ack)\n\n` +
        snapTable([...firstRecs, ...second].sort((a, b) => a.sentAt - b.sentAt), { t0: s1.ackAt }),
    );
    await sleep(2500);
  }

  const totalBehind = groups.reduce((a, g) => a + (g.behind || 0), 0);
  const ok = totalBehind === 0 && groups.every((g) => !g.error);
  return {
    title: "2. Notification before the tag purge propagates",
    what:
      `Before each trigger one GET warms the ja entry at the old rev. Then an admin save, and ${p.k} parallel \`minRev=<new rev>\` requests fired at ack + ${p.offsets.join("/")} ms` +
      `${p.broadcast ? ", on receipt of the save's Realtime broadcast (public `event:111`, event `rev`)" : ""}` +
      `${p.backToBack ? ", and for two back-to-back saves (the 2nd save's requests can meet the 1 s revision memo)" : ""}. ` +
      "A response is *behind* if its `rev` < the requested `minRev` (which is the committed revision, so a DB read at request time sees it).",
    verdict: verdictLine(ok, `${totalBehind} responses behind the requested (committed) revision across ${groups.length} trigger groups.`),
    ok,
    suspects: totalBehind
      ? [
          `${totalBehind} \`minRev\` responses came back below the requested revision although the save had committed before the request was sent. The route never re-reads the DB when \`verifiedRevision\` has a remembered value younger than REV_MEMO_MS = 1 s (src/lib/liveSnapshot.ts:392, 400-421), and requests that join an in-flight cached read get its (pre-purge) result (src/lib/liveSnapshot.ts:471-474). In R1 a notification's \`minRev\` is single-use, so such a client waits for the next periodic fetch (≤ 24 s) — within the invariant, but not within the 3 s freshness target. Repro: the trigger group(s) with behind > 0 above (check their \`source\`).`,
        ]
      : [],
    summary: [
      "| trigger | rev | n | behind | behind by source | sources | revs | errors | extra |",
      "|---|---|---|---|---|---|---|---|---|",
      ...groups.map(
        (g) =>
          `| ${g.variant} | ${g.rev ?? ""} | ${g.n ?? ""} | ${g.behind ?? ""} | ${fmtCounts(g.behindSources || {})} | ${fmtCounts(g.sources || {})} | ${fmtCounts(g.revs || {})} | ${g.errors ?? g.error ?? ""} | ${g.bcastMinusAckMs !== undefined ? `broadcast − ack = ${g.bcastMinusAckMs} ms` : g.gapMs !== undefined ? `ack gap ${g.gapMs} ms` : ""} |`,
      ),
    ].join("\n"),
    evidence,
    raw: groups,
  };
}

// ---------------------------------------------------------------------
// race 3 — single viewer in a sparse locale
// ---------------------------------------------------------------------

async function race3(p) {
  const admin = ctx.admin;
  const trials = [];
  const evidence = [];
  // Reference: a warm cache hit's latency for the same route.
  await snap(BASE, { locale: "ja", label: "ref-warm" });
  const ref = await snap(BASE, { locale: "ja", label: "ref-hit" });
  for (let i = 0; i < p.repeats; i++) {
    for (const order of ["minRev-first", "plain-first"]) {
      await snap(BASE, { locale: "en", label: "en-warm" }); // an en entry exists, then goes idle
      await sleep(p.idleMs);
      const s = await admin.save();
      const a =
        order === "minRev-first"
          ? await snap(BASE, { locale: "en", minRev: s.rev, label: "en-minRev" })
          : await snap(BASE, { locale: "en", label: "en-plain" });
      const b =
        order === "minRev-first"
          ? await snap(BASE, { locale: "en", label: "en-plain" })
          : await snap(BASE, { locale: "en", minRev: s.rev, label: "en-minRev" });
      trials.push({ order, rev: s.rev, first: a, second: b, ok: a.rev >= s.rev && b.rev >= s.rev });
      evidence.push(`#### ${order} #${i + 1} (save rev ${s.rev}, ack at ${s.ackAt})\n\n` + snapTable([a, b], { t0: s.ackAt }));
      await sleep(1000);
    }
  }
  // The task's sequence is minRev first, then plain: that is the gate.
  // plain-first is informative (a sparse viewer's periodic fetch right
  // after a save, no notification) and reported separately.
  const gate = trials.filter((t) => t.order === "minRev-first");
  const ok = gate.every((t) => t.ok);
  return {
    title: "3. Single viewer in a sparse locale (en)",
    what:
      `Warm one \`locale=en\` entry, let it idle ${p.idleMs} ms (past the 2 s TTL), save, then ONE en request with \`minRev=<new rev>\` followed by ONE without (gate), and the reverse order (informative). ${p.repeats}× each. Reference warm ja hit: ${ref.ms} ms (${ref.source}).`,
    verdict: verdictLine(ok, `minRev-first: ${gate.filter((t) => t.ok).length}/${gate.length} trials with both responses at the new rev; plain-first (info): ${trials.filter((t) => t.order === "plain-first" && t.ok).length}/${trials.filter((t) => t.order === "plain-first").length}.`),
    ok,
    suspects: trials
      .filter((t) => !t.ok)
      .map(
        (t) =>
          `${t.order}: after save rev ${t.rev} an en request returned rev ${t.first.rev < t.rev ? t.first.rev : t.second.rev} (${t.first.rev < t.rev ? t.first.source : t.second.source}). A sparse-locale entry that idled past its 2 s TTL is served stale-while-revalidate by \`unstable_cache\` (src/lib/liveSnapshot.ts:318-325, src/lib/dataCache.ts:184) unless the save's purge reached it; ${t.order === "minRev-first" ? "with minRev the repair path (src/lib/liveSnapshot.ts:474-488) should have caught it" : "a plain request has no repair, so it shows until the next fetch"}.`,
      ),
    summary: [
      "| order | rev | 1st: rev / source / ms | 2nd: rev / source / ms | both at new rev |",
      "|---|---|---|---|---|",
      ...trials.map(
        (t) =>
          `| ${t.order} | ${t.rev} | ${t.first.rev} / ${t.first.source} / ${t.first.ms} | ${t.second.rev} / ${t.second.source} / ${t.second.ms} | ${t.ok ? "yes" : "NO"} |`,
      ),
    ].join("\n"),
    evidence,
    raw: { ref, trials },
  };
}

// ---------------------------------------------------------------------
// race 4 — regeneration while the DB pool is saturated
// ---------------------------------------------------------------------

/**
 * Starve the transaction pooler: `conns` concurrent `SELECT pg_sleep(secs)`
 * on DATABASE_URL (6543). In transaction mode a server connection is held
 * only while a query runs, so once the sleeping queries occupy every
 * server connection of the pool, every other client of the pooler —
 * including the preview's Prisma — queues behind them.
 *
 * The pool is NOT 15 for this user on dev, whatever the dashboard says:
 * with 15 sleepers a 16th query still ran at once; with 25 sleepers only
 * 17 were active server-side and the next query queued until they ended
 * (probe, 2026-10-10). Hence the default of 22 and the explicit
 * saturation check: a probe client, connected BEFORE the sleepers start
 * (so TLS/auth time is not counted), runs `SELECT 1` 500 ms in and must
 * wait at least half the sleep — otherwise the race reports "not
 * saturated" instead of a result. Sleepers beyond the pool size queue
 * as a second wave; `release()` closes every client once the first
 * wave is over, which drops the queued ones.
 */
async function saturate(conns, secs) {
  const mk = () => new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 20000 });
  const holders = Array.from({ length: conns }, mk);
  const probeClient = mk();
  // A client whose socket is killed under a queued query emits 'error';
  // without a listener that would crash the process.
  for (const c of [...holders, probeClient]) c.on("error", () => {});
  await Promise.all([...holders, probeClient].map((c) => c.connect()));
  const closeAll = () => Promise.all([...holders, probeClient].map((c) => c.end().catch(() => {})));
  ctx.cleanups.push(closeAll);
  const startedAt = now();
  const done = holders.map((c) =>
    c
      .query(`SELECT pg_sleep($1)`, [secs])
      .then(() => ({ ok: true, at: now() - startedAt }))
      .catch((e) => ({ ok: false, err: e.message, at: now() - startedAt })),
  );
  const probe = (async () => {
    await sleep(500);
    const t = now();
    try {
      await probeClient.query("SELECT 1");
      return { waitedMs: now() - t };
    } catch (e) {
      return { waitedMs: now() - t, err: e.message };
    }
  })();
  // Server-side view at +1 s through the SESSION pooler (5432, a
  // separate pool): how many sleepers actually hold a backend.
  const active = (async () => {
    await sleep(1000);
    try {
      const r = await (await db()).query(
        `SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE state = 'active' AND query ILIKE '%pg_sleep%' AND pid <> pg_backend_pid()`,
      );
      return r.rows[0].n;
    } catch {
      return null;
    }
  })();
  return {
    startedAt,
    endsAt: startedAt + secs * 1000,
    async release() {
      const pr = await probe;
      const sleeping = await active;
      while (now() < startedAt + secs * 1000 + 200) await sleep(100);
      await closeAll();
      ctx.cleanups.splice(ctx.cleanups.indexOf(closeAll), 1);
      const res = await Promise.all(done);
      return { holders: res, probe: pr, sleeping, saturated: !pr.err && pr.waitedMs >= (secs * 1000) / 2 };
    },
  };
}

async function race4(p) {
  const admin = ctx.admin;
  const phases = [];
  const evidence = [];
  const openLoop = async (streams, until, everyMs = 1000) => {
    const pending = [];
    while (now() < until) {
      for (const s of streams) pending.push(snap(BASE, { ...s, timeoutMs: 60000 }));
      await sleep(everyMs);
    }
    return (await Promise.all(pending)).sort((a, b) => a.sentAt - b.sentAt);
  };

  for (const phase of ["warm-then-saturate", "purged-then-saturate"]) {
    let s;
    if (phase === "warm-then-saturate") {
      s = await admin.save();
      await sleep(1000);
      await snap(BASE, { locale: "ja", label: "prebuild" });
      await snap(BASE, { locale: "en", label: "prebuild" });
    } else {
      s = await admin.save(); // purge — every read below must build
    }
    const committed = s.rev;
    const sat = await saturate(p.conns, p.sleepSecs);
    const streams =
      phase === "warm-then-saturate"
        ? [
            { locale: "ja", label: "ja" },
            // forged-looking hint above the DB revision → the repair check
            // must read the DB revision (blocked by the saturation)
            { locale: "ja", minRev: committed + 1, label: "ja-hint+1" },
          ]
        : [
            { locale: "ja", label: "ja" },
            { locale: "ja", minRev: committed, label: "ja-minRev" },
            { locale: "ko", label: "ko" },
          ];
    const recs = await openLoop(streams, sat.endsAt + p.tailSecs * 1000);
    const rel = await sat.release();
    const during = recs.filter((r) => r.sentAt < sat.endsAt);
    const afterRel = recs.filter((r) => r.sentAt >= sat.endsAt);
    // Per stream (= one client):
    //  - server regression: a response older than a revision this
    //    stream had already RECEIVED when it sent the request (the cache
    //    handed out something older than the client already had — the
    //    acceptance rule must and does reject it; info, not a failure);
    //  - client backwards: replaying the stream's responses in arrival
    //    order through the app's SnapshotAcceptance, an applied revision
    //    lower than an earlier applied one (the invariant; must be 0).
    const { SnapshotAcceptance } = await loadAcceptance();
    const regressions = [];
    let clientBackwards = 0;
    for (const lbl of new Set(recs.map((r) => r.label))) {
      const mine = recs.filter((x) => x.label === lbl && x.http === 200 && x.rev !== null);
      for (const r of mine) {
        const had = Math.max(-1, ...mine.filter((q) => q.recvAt <= r.sentAt).map((q) => q.rev));
        if (r.rev < had) regressions.push(r);
      }
      const client = new SnapshotAcceptance();
      let hi = -1;
      for (const r of [...mine].sort((a, b) => a.recvAt - b.recvAt)) {
        if (client.evaluate(client.generation, r.body).apply) {
          if (r.rev < hi) clientBackwards++;
          hi = Math.max(hi, r.rev);
        }
      }
    }
    // Convergence: the plain ja stream returns the committed revision no
    // later than REPAIR_MS after the pool is released, and its last
    // response is at it.
    const jaPlain = recs.filter((r) => r.label === "ja").sort((a, b) => a.recvAt - b.recvAt);
    const lastJa = jaPlain[jaPlain.length - 1];
    const converged =
      jaPlain.some((r) => r.http === 200 && r.rev >= committed && r.recvAt <= sat.endsAt + REPAIR_MS) &&
      lastJa?.http === 200 &&
      lastJa.rev >= committed;
    phases.push({
      phase,
      committed,
      probe: rel.probe,
      saturated: rel.saturated,
      sleeping: rel.sleeping,
      holdersOk: rel.holders.filter((h) => h.ok).length,
      holderErrors: [...new Set(rel.holders.filter((h) => !h.ok).map((h) => h.err))],
      during: { n: during.length, http: countBy(during, (r) => r.http ?? r.error), sources: countBy(during, "source"), revs: countBy(during, "rev"), msMax: Math.max(0, ...during.map((r) => r.ms)) },
      after: { n: afterRel.length, http: countBy(afterRel, (r) => r.http ?? r.error), sources: countBy(afterRel, "source"), revs: countBy(afterRel, "rev") },
      regressions: regressions.length,
      clientBackwards,
      converged,
      // Observations that feed the suspects list below.
      slowCacheHits: during.filter((r) => r.minRev === null && r.source === "cache" && r.ms > 2000).map((r) => r.ms),
      http5xx: during.filter((r) => r.http >= 500).length,
      emptyBody5xx: during.filter((r) => r.http >= 500 && /non-JSON body \(0 B\)/.test(r.error || "")).length,
      slowHints: recs.filter((r) => r.label === "ja-hint+1" && r.ms > 2000).map((r) => r.ms),
    });
    evidence.push(
      `#### ${phase} (committed rev ${committed}; saturation +0 … +${p.sleepSecs * 1000} ms; ${rel.sleeping ?? "?"} sleepers active server-side; probe \`SELECT 1\` waited ${rel.probe.waitedMs} ms${rel.probe.err ? ` (${rel.probe.err})` : ""} → ${rel.saturated ? "saturated" : "NOT saturated"}; sleeper outcomes: ${fmtCounts(countBy(rel.holders, (h) => (h.ok ? "slept" : h.err)))})\n\n` +
        snapTable(recs, { t0: sat.startedAt }),
    );
    await sleep(3000);
  }
  const saturatedAll = phases.every((x) => x.saturated);
  const ok = saturatedAll && phases.every((x) => x.clientBackwards === 0 && x.converged);
  const slow = phases.flatMap((x) => x.slowCacheHits);
  const slowHints = phases.flatMap((x) => x.slowHints);
  const e5 = phases.reduce((a, x) => a + x.http5xx, 0);
  const e5empty = phases.reduce((a, x) => a + x.emptyBody5xx, 0);
  const suspects = [];
  if (slow.length)
    suspects.push(
      `Cache hits held hostage by the DB: ${slow.length} plain requests answered from the cache (\`x-snapshot-source: cache\`, \`servedAt\` right after arrival) took ${Math.min(...slow)}–${Math.max(...slow)} ms to arrive. Once the 2 s entry is stale, \`unstable_cache\` returns it and regenerates in the background (src/lib/liveSnapshot.ts:318-325 → src/lib/dataCache.ts:184, \`revalidate: 2\`), and the response is evidently not delivered until that regeneration settles — Prisma's \`maxWait: 5_000\` (src/lib/liveSnapshot.ts:270) or the pool freeing up. So under DB pressure the cache stops shielding latency even though it still shields the DB. Repro: race 4 \`warm-then-saturate\`; compare \`servedAt\` with the receive time.`,
    );
  if (e5)
    suspects.push(
      `${e5} responses were HTTP 5xx during the saturation (${e5empty} with an empty body), each after ~5 s: a build that cannot get a connection within \`maxWait\` (src/lib/liveSnapshot.ts:270) — or the repair check's revision read that cannot get one at all — throws out of \`getLiveSnapshot\`, and the route has no error handling around it (src/app/api/setlist/route.ts:65), so Next answers a bare 500 with no \`Retry-After\`. Safe for the client (a non-2xx is a failure → n13 retry schedule; nothing stale is applied), but a 503 + \`Retry-After\` — or serving the last good entry — would be the deliberate version. Repro: race 4 \`purged-then-saturate\`.`,
    );
  if (slowHints.length)
    suspects.push(
      `The repair check's uncached revision read has no timeout of its own (src/lib/liveSnapshot.ts:413-420): with the pool saturated, every request carrying a hint above the cached rev — and on the public channel anyone can send one — was held ${Math.min(...slowHints)}–${Math.max(...slowHints)} ms, for the whole DB stall. Repro: race 4 \`warm-then-saturate\`, stream \`ja-hint+1\`.`,
    );
  return {
    title: "4. Regeneration while the DB pool is saturated",
    what:
      `A failing build can't be forced on the deployed preview, so the pool is starved instead: ${p.conns} concurrent \`SELECT pg_sleep(${p.sleepSecs})\` on DATABASE_URL (6543 transaction pooler), plus a pre-connected probe client whose \`SELECT 1\` (500 ms in) must queue for ≥ half the sleep to count as saturated. ` +
      "Phase `warm-then-saturate`: save, build ja/en, then saturate; open-loop 1 rps of plain ja and ja with a hint one above the DB rev (forces the uncached revision read). " +
      "Phase `purged-then-saturate`: save (purges `event:111`), then saturate immediately; open-loop 1 rps of plain ja, ja `minRev=<committed>`, and plain ko. " +
      `Requests time out client-side at 60 s; polling continues ${p.tailSecs} s after the sleeps end. All pooler connections are closed afterwards.`,
    verdict: saturatedAll
      ? verdictLine(ok, `client applied nothing backwards (${phases.map((x) => `${x.phase}: ${x.clientBackwards}`).join(", ")}; server regressions the client rejected: ${phases.map((x) => `${x.phase}: ${x.regressions}`).join(", ")}); converged to the committed rev after release: ${phases.map((x) => `${x.phase}: ${x.converged ? "yes" : "NO"}`).join(", ")}. Behaviour during saturation is documented below (status codes / sources / max latency).`)
      : `**FAIL (inconclusive)** — the pool was NOT saturated in ${phases.filter((x) => !x.saturated).map((x) => x.phase).join(", ")} (probe query did not queue); re-run with a higher \`--r4-conns\`.`,
    ok,
    suspects,
    summary: [
      "| phase | committed | sleepers active | probe wait ms | saturated | holders slept | during: http | during: sources | during: revs | during: max ms | after: http | after: revs | server regressions | client backwards | converged |",
      "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
      ...phases.map(
        (x) =>
          `| ${x.phase} | ${x.committed} | ${x.sleeping ?? "?"} | ${x.probe.waitedMs}${x.probe.err ? ` (${x.probe.err})` : ""} | ${x.saturated ? "yes" : "NO"} | ${x.holdersOk}/${p.conns} | ${fmtCounts(x.during.http)} | ${fmtCounts(x.during.sources)} | ${fmtCounts(x.during.revs)} | ${x.during.msMax} | ${fmtCounts(x.after.http)} | ${fmtCounts(x.after.revs)} | ${x.regressions} | ${x.clientBackwards} | ${x.converged ? "yes" : "NO"} |`,
      ),
    ].join("\n"),
    evidence,
    raw: phases,
  };
}

// ---------------------------------------------------------------------
// race 5 — stale response arriving last
// ---------------------------------------------------------------------

async function race5(p) {
  const admin = ctx.admin;
  const { SnapshotAcceptance } = await loadAcceptance();
  const trials = [];
  const evidence = [];

  // Why throttling: on the preview a save takes ~350–450 ms end to end
  // while a cold en build answers in ~250 ms, so A (sent before the
  // save) always lands before B (sent at the save's ack) unless A's
  // delivery is slowed. `throttleMs` holds A's response body for that
  // long AFTER the server produced it — a slow downlink, the realistic
  // way an old response overtakes a newer one (two requests in flight
  // across a reconnect, the R3 fallback hand-over). A's content
  // (rev, capturedAt) is whatever the server really built; throttle 0
  // trials are the un-throttled control.
  const runTrial = async (i, throttleMs, d) => {
    // Seed the client (applied = current rev), then purge so A builds.
    const seed = await snap(BASE, { locale: "en", label: "seed" });
    const client = new SnapshotAcceptance({ rev: seed.rev, capturedAt: seed.capturedAt });
    const gen = client.generation;
    await admin.save();
    await sleep(1000);
    const arrivals = [];
    const A = snap(BASE, { locale: "en", label: "A", throttleMs }).then((r) => (arrivals.push(r), r));
    if (d) await sleep(d);
    const s = await admin.save();
    const B = snap(BASE, { locale: "en", minRev: s.rev, label: "B" }).then((r) => (arrivals.push(r), r));
    const [a, b] = await Promise.all([A, B]);
    // Replay in REAL arrival order (each response handed to the
    // acceptance rule the moment it arrived, as the hook does).
    const steps = [];
    for (const r of arrivals) {
      if (!r.body) {
        steps.push({ label: r.label, rev: null, applied: false, note: r.error || `HTTP ${r.http}` });
        continue;
      }
      const v = client.evaluate(gen, r.body);
      steps.push({ label: r.label, rev: r.rev, capturedAt: r.capturedAt, applied: v.apply, appliedRevAfter: client.applied.rev });
    }
    const aStale = a.rev !== null && a.rev < s.rev;
    const aLast = a.recvAt > b.recvAt;
    // Backwards = an applied step whose rev is below a rev applied earlier.
    let hi = -1;
    let backwards = false;
    for (const st of steps) {
      if (!st.applied) continue;
      if (st.rev < hi) backwards = true;
      hi = Math.max(hi, st.rev);
    }
    const t = {
      trial: i + 1,
      throttleMs,
      delay: d,
      rev: s.rev,
      A: { rev: a.rev, source: a.source, sent: a.sentAt - s.ackAt, recv: a.recvAt - s.ackAt },
      B: { rev: b.rev, source: b.source, sent: b.sentAt - s.ackAt, recv: b.recvAt - s.ackAt },
      inverted: aStale && aLast,
      steps,
      finalRev: client.applied.rev,
      ok: client.applied.rev >= s.rev && !backwards,
      backwards,
    };
    trials.push(t);
    evidence.push(
      `#### trial ${i + 1} — A throttled ${throttleMs} ms, save ${d} ms after A, save rev ${s.rev}; times relative to the save ack\n\n` +
        snapTable([a, b], { t0: s.ackAt }) +
        "\n\nReplay in arrival order through `SnapshotAcceptance` (src/lib/snapshotAcceptance.ts, the app's own class):\n\n" +
        steps.map((st) => `- ${st.label}: rev ${st.rev} → ${st.applied ? "APPLIED" : "rejected"}${st.note ? ` (${st.note})` : ""}; applied rev now ${st.appliedRevAfter ?? "—"}`).join("\n"),
    );
    await sleep(1500);
  };

  let i = 0;
  for (const throttleMs of p.throttles) for (const d of p.delays) await runTrial(i++, throttleMs, d);
  const inverted = trials.filter((t) => t.inverted);
  // The race is only exercised when a stale A really arrived after B;
  // a run without a single such trial proves nothing → FAIL.
  const ok = trials.every((t) => t.ok) && inverted.length > 0 && inverted.every((t) => t.steps.find((s) => s.label === "A")?.applied === false);
  return {
    title: "5. Stale response arriving last",
    what:
      `Per trial: seed a client (applied rev) from one en GET, purge with a save (1 s settle), fire request A (en, no minRev → cold build), ${p.delays.join("/")} ms later an admin save, and at its ack request B (en, \`minRev=<new rev>\`). ` +
      `A's response delivery is throttled by ${p.throttles.join("/")} ms (0 = control). Both responses are handed in their real arrival order to the app's own \`SnapshotAcceptance\` (imported from \`src/lib/snapshotAcceptance.ts\`). ` +
      "Pass: every trial ends at ≥ the committed rev without applying a backwards snapshot, and at least one trial really had the stale A arrive after B — with A rejected.",
    verdict: verdictLine(ok, `${trials.filter((t) => t.ok).length}/${trials.length} trials ended at the committed rev with nothing applied backwards; stale-A-after-B trials: ${inverted.length} (A rejected in ${inverted.filter((t) => t.steps.find((s) => s.label === "A")?.applied === false).length}).`),
    ok,
    suspects: trials
      .filter((t) => !t.ok)
      .map(
        (t) =>
          t.backwards
            ? `Trial ${t.trial}: the client applied a lower revision after a higher one — \`shouldApply\` / \`SnapshotAcceptance.evaluate\` (src/lib/snapshotAcceptance.ts:69-78, 241-286). Replay order: ${t.steps.map((s) => `${s.label}@${s.rev}:${s.applied ? "apply" : "reject"}`).join(", ")}.`
            : `Trial ${t.trial}: the client ended at rev ${t.finalRev} < committed ${t.rev}; B (\`minRev=${t.rev}\`) returned rev ${t.B.rev} from \`${t.B.source}\` — the repair path (src/lib/liveSnapshot.ts:474-488) did not deliver the committed revision.`,
      ),
    summary: [
      "| trial | A throttle ms | save delay | rev | A rev/source | A recv | B rev/source | B recv | stale A last | arrival order → verdict | final rev | ok |",
      "|---|---|---|---|---|---|---|---|---|---|---|---|",
      ...trials.map(
        (t) =>
          `| ${t.trial} | ${t.throttleMs} | ${t.delay} | ${t.rev} | ${t.A.rev}/${t.A.source} | ${t.A.recv} | ${t.B.rev}/${t.B.source} | ${t.B.recv} | ${t.inverted ? "yes" : ""} | ${t.steps.map((s) => `${s.label}:${s.applied ? "apply" : "reject"}`).join(" ")} | ${t.finalRev} | ${t.ok ? "yes" : "NO"} |`,
      ),
    ].join("\n"),
    evidence,
    raw: trials,
  };
}

// ---------------------------------------------------------------------
// race 6 — status boundary without a write
// ---------------------------------------------------------------------

const SSR_ONGOING = /\\?"isOngoing\\?":(true|false)/;

async function ssr(eventId) {
  const sentAt = now();
  try {
    const res = await fetch(`${BASE}/ja/events/${eventId}`, { redirect: "follow", signal: AbortSignal.timeout(30000) });
    const html = await res.text();
    const m = SSR_ONGOING.exec(html);
    const rev = /\\?"initialRev\\?":(\d+|null)/.exec(html);
    return {
      label: "ssr",
      sentAt,
      recvAt: now(),
      http: res.status,
      isOngoing: m ? m[1] === "true" : null,
      initialRev: rev ? rev[1] : null,
      date: res.headers.get("date"),
      vercelId: res.headers.get("x-vercel-id"),
    };
  } catch (e) {
    return { label: "ssr", sentAt, recvAt: now(), error: String(e?.message || e) };
  }
}

async function race6(p) {
  const c = await db();
  const slug = `n14-races-status-${Date.now()}`;
  const ins = await c.query(
    `INSERT INTO "Event" (slug, type, status, "startTime", "originalName", "originalLanguage")
     VALUES ($1, 'concert', 'scheduled', now() + make_interval(secs => $2), $3, 'ja')
     RETURNING id::text AS id, "startTime"`,
    [slug, p.leadSecs, "n14 races status boundary (throwaway)"],
  );
  const id = ins.rows[0].id;
  const startTime = new Date(ins.rows[0].startTime);
  const dropEvent = async () => {
    await c.query(`DELETE FROM "Event" WHERE id = $1 AND slug = $2`, [id, slug]);
  };
  ctx.cleanups.push(dropEvent);
  const createdAt = now();
  const stopAt = createdAt + (p.leadSecs + p.afterSecs) * 1000;
  const apiRecs = [];
  const ssrRecs = [];
  try {
    await Promise.all([
      (async () => {
        while (now() < stopAt) {
          const t = now();
          apiRecs.push(await snap(BASE, { eventId: id, locale: "ja", label: "api" }));
          await sleep(Math.max(0, 1000 - (now() - t)));
        }
      })(),
      (async () => {
        while (now() < stopAt) {
          const t = now();
          ssrRecs.push(await ssr(id));
          await sleep(Math.max(0, p.ssrEveryMs - (now() - t)));
        }
      })(),
    ]);
  } finally {
    await dropEvent();
    ctx.cleanups.splice(ctx.cleanups.indexOf(dropEvent), 1);
  }
  const left = await c.query(`SELECT count(*)::int AS n FROM "Event" WHERE id = $1`, [id]);

  // Server-clock offset of each API response relative to startTime
  // (servedAt is the function's clock, startTime the DB's — both server
  // side, unlike the generator's clock).
  const off = (r) => (r.servedAt ? Date.parse(r.servedAt) - startTime.getTime() : null);
  const SKEW = 1000; // tolerance for function vs DB clock skew
  const wrongBefore = apiRecs.filter((r) => off(r) !== null && off(r) < -SKEW && r.status !== "upcoming");
  const wrongAfter = apiRecs.filter((r) => off(r) !== null && off(r) > SKEW && r.status !== "ongoing");
  const firstOngoing = apiRecs.find((r) => r.status === "ongoing");
  // The proof that the flip needed no rebuild: an `ongoing` response whose
  // snapshot was captured BEFORE startTime (so it was built while the
  // event was still upcoming and is being served from the cache).
  const ongoingFromOldSnapshot = apiRecs.filter((r) => r.status === "ongoing" && r.capturedAt && Date.parse(r.capturedAt) < startTime.getTime());
  const revs = countBy(apiRecs, "rev");
  const nearBoundary = apiRecs.filter((r) => off(r) !== null && Math.abs(off(r)) <= 3000);
  // SSR: generator clock only (HTML carries no server timestamp beyond
  // the Date header, 1 s resolution) — map startTime onto the generator
  // clock via the API responses' servedAt (≈ recvAt − RTT/2).
  const genOffset = apiRecs.filter((r) => r.servedAt).map((r) => (r.sentAt + r.recvAt) / 2 - (Date.parse(r.servedAt) - startTime.getTime()));
  const startOnGen = genOffset.length ? genOffset.reduce((a, b) => a + b, 0) / genOffset.length : null;
  const ssrRel = (r) => (startOnGen === null ? null : Math.round((r.sentAt + r.recvAt) / 2 - startOnGen));
  const ssrWrong = ssrRecs.filter((r) => ssrRel(r) !== null && ((ssrRel(r) < -SKEW && r.isOngoing === true) || (ssrRel(r) > SKEW && r.isOngoing === false)));
  const ssrFlip = ssrRecs.find((r) => r.isOngoing === true);
  const ssrSeenFalse = ssrRecs.some((r) => r.isOngoing === false);
  const apiOk = wrongBefore.length === 0 && wrongAfter.length === 0 && !!firstOngoing && apiRecs.some((r) => r.status === "upcoming") && Object.keys(revs).length === 1;
  const ssrOk = ssrWrong.length === 0 && !!ssrFlip && ssrSeenFalse;
  const ok = apiOk && ssrOk && ongoingFromOldSnapshot.length > 0 && left.rows[0].n === 0;
  return {
    title: "6. Status boundary without a write",
    what:
      `Inserted a throwaway Event (id ${id}, slug \`${slug}\`, status \`scheduled\`, startTime = DB now() + ${p.leadSecs} s = ${startTime.toISOString()}) with pg, polled \`/api/setlist?eventId=${id}&locale=ja\` every 1 s and the SSR page \`/ja/events/${id}\` every ${p.ssrEveryMs} ms from creation to startTime + ${p.afterSecs} s, then hard-deleted the row (rows left: ${left.rows[0].n}). No write touched the event in between.`,
    verdict: verdictLine(
      ok,
      `API: upcoming before / ongoing after (±${SKEW} ms skew) — wrong before ${wrongBefore.length}, wrong after ${wrongAfter.length}; rev constant (${fmtCounts(revs)}); ` +
        `${ongoingFromOldSnapshot.length} \`ongoing\` responses came from a snapshot captured before startTime (sources: ${fmtCounts(countBy(ongoingFromOldSnapshot, "source"))}); ` +
        `first ongoing at servedAt − startTime = ${firstOngoing ? off(firstOngoing) : "—"} ms (source ${firstOngoing?.source ?? "—"}). ` +
        `SSR: flipped to isOngoing=true ${ssrFlip ? `at ≈ ${ssrRel(ssrFlip)} ms` : "NEVER"}; wrong-side renders ${ssrWrong.length}.`,
    ),
    ok,
    suspects: [
      ...(wrongBefore.length || wrongAfter.length
        ? [`API status on the wrong side of startTime (${wrongBefore.length} before, ${wrongAfter.length} after): \`resolveSnapshotForResponse\` (src/lib/liveSnapshot.ts:496-521) should resolve it from the cached raw status/startTime at response time via \`getEventStatus\` (src/lib/eventStatus.ts).`]
        : []),
      ...(ssrWrong.length || !ssrFlip
        ? [`SSR status on the wrong side of startTime / never flipped: the event page resolves it from the 30 s cached status row (\`getEventStatusRow\` + \`getEventStatus\`, src/app/[locale]/events/[id]/[[...slug]]/page.tsx:309-352).`]
        : []),
      ...(Object.keys(revs).length > 1 ? [`The revision changed (${fmtCounts(revs)}) although nothing wrote to the throwaway event.`] : []),
    ],
    summary: [
      "Responses within ±3 s of startTime:",
      "",
      "| servedAt − startTime ms | status | source | rev | capturedAt − startTime ms | ms |",
      "|---|---|---|---|---|---|",
      ...nearBoundary.map((r) => `| ${off(r)} | ${r.status} | ${r.source} | ${r.rev} | ${r.capturedAt ? Date.parse(r.capturedAt) - startTime.getTime() : ""} | ${r.ms} |`),
      "",
      "SSR renders:",
      "",
      "| ≈ t − startTime ms | http | isOngoing | initialRev | x-vercel-id | error |",
      "|---|---|---|---|---|---|",
      ...ssrRecs.map((r) => `| ${ssrRel(r)} | ${r.http ?? ""} | ${r.isOngoing} | ${r.initialRev ?? ""} | ${r.vercelId ?? ""} | ${r.error ?? ""} |`),
    ].join("\n"),
    evidence: [
      `#### all API responses (times relative to the event's creation; startTime ≈ +${p.leadSecs * 1000} ms)\n\n` +
        snapTable(apiRecs, { t0: createdAt, extra: [["servedAt − startTime", (r) => off(r) ?? ""]] }),
    ],
    raw: { id, slug, startTime: startTime.toISOString(), api: apiRecs, ssr: ssrRecs },
  };
}

// ---------------------------------------------------------------------
// main
// ---------------------------------------------------------------------

const RACES = { 1: race1, 2: race2, 3: race3, 4: race4, 5: race5, 6: race6 };

async function cleanupOnly() {
  const before = await visibleRows();
  const ids = await leftoverRows();
  let deleted = [];
  if (ids.length) {
    const admin = await adminSession(BASE);
    deleted = await admin.deleteIds(ids);
  }
  const ev = await (await db()).query(`SELECT id::text, slug FROM "Event" WHERE slug LIKE 'n14-races-status-%'`);
  for (const r of ev.rows) await (await db()).query(`DELETE FROM "Event" WHERE id = $1 AND slug = $2`, [r.id, r.slug]);
  console.log(JSON.stringify({ visibleBefore: before, leftoverRows: ids, deleted, droppedEvents: ev.rows, visibleAfter: await visibleRows() }, null, 2));
}

async function main() {
  if (args.race === "cleanup") {
    await cleanupOnly();
    await closeDb(); // the open pg client would otherwise keep the process alive
    return;
  }
  const which =
    !args.race || args.race === "all" || args.race === true
      ? [1, 2, 3, 4, 5, 6]
      : String(args.race).split(",").map(Number).filter((n) => RACES[n]);
  if (!which.length) throw new Error(`unknown --race=${args.race}`);

  const startedIso = new Date().toISOString();
  const rowsBefore = await visibleRows();
  const revBefore = await dbRev();
  const leftovers = await leftoverRows();
  if (leftovers.length) throw new Error(`leftover ${leftovers.join(",")} rows from an earlier run — run --race=cleanup first`);
  if (rowsBefore !== EXPECTED_BASE_ROWS) console.warn(`warning: event ${EVENT_ID} has ${rowsBefore} visible rows (expected ${EXPECTED_BASE_ROWS})`);

  ctx.admin = await adminSession(BASE);
  let interrupted = false;
  const finish = async () => {
    for (const f of ctx.cleanups.splice(0)) await f().catch((e) => console.error("cleanup:", e.message));
    // `close()` always resolves to the array of ids it could not soft-delete
    // (empty on success), which is what `cleanupFailures` below expects.
    return ctx.admin.close();
  };
  process.on("SIGINT", async () => {
    if (interrupted) process.exit(130);
    interrupted = true;
    console.error("\ninterrupted — cleaning up");
    await finish().catch(() => {});
    await closeDb();
    process.exit(130);
  });

  const results = [];
  let cleanupFailures = [];
  try {
    await ctx.admin.open();
    console.log(`scratch row ${ctx.admin.rowId} on event ${EVENT_ID} (scale ${SCALE})`);
    for (const n of which) {
      const t = now();
      console.log(`race ${n} …`);
      try {
        const r = await RACES[n](P[`r${n}`]);
        r.secs = Math.round((now() - t) / 1000);
        results.push(r);
        console.log(`race ${n}: ${r.ok ? "PASS" : "FAIL"} (${r.secs} s)`);
      } catch (e) {
        results.push({ title: `${n}. (crashed)`, ok: false, verdict: `**ERROR** — ${e.stack || e}`, what: "", summary: "", evidence: [] });
        console.error(`race ${n} crashed:`, e);
      }
    }
  } finally {
    cleanupFailures = await finish();
  }

  const rowsAfter = await visibleRows();
  const leftAfter = await leftoverRows();
  const revAfter = await dbRev();
  await closeDb();

  // ---------- report ----------
  const date = startedIso.slice(0, 10);
  const stamp = startedIso.replace(/[:.]/g, "-");
  // Next to the other run results, wherever the script is launched from.
  const dir = args.out || path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "results", date);
  fs.mkdirSync(dir, { recursive: true });
  const md = [
    `# n14 run #2 — cache races (${SCALE})`,
    "",
    `- Started ${startedIso}; target \`${BASE}\`; event ${EVENT_ID}; generator: this machine (one IP).`,
    `- Event ${EVENT_ID}: visible rows ${rowsBefore} → ${rowsAfter} (expected ${EXPECTED_BASE_ROWS}); setlistRevision ${revBefore} → ${revAfter} (${ctx.admin.saves.length} saves by this run); live rows left by this tool: ${leftAfter.length ? leftAfter.join(", ") : "none"}${cleanupFailures.length ? `; cleanup failures: ${cleanupFailures.join("; ")}` : ""}.`,
    // Revisions this run did not produce = somebody else saved event 111
    // meanwhile (another load stream, an operator) — the race timings
    // are then contaminated and the run should be repeated alone.
    `- Foreign saves on event ${EVENT_ID} during the run: ${revAfter - revBefore - ctx.admin.saves.filter((s) => s.http >= 200 && s.http < 300).length}${revAfter - revBefore - ctx.admin.saves.filter((s) => s.http >= 200 && s.http < 300).length > 0 ? " — **other traffic wrote to the event; timings are contaminated, re-run alone**" : " (clean)"}.`,
    `- Saves: ${ctx.admin.saves.length}, latency p50 ${median(ctx.admin.saves.map((s) => s.ms))} ms, max ${Math.max(...ctx.admin.saves.map((s) => s.ms))} ms; statuses ${fmtCounts(countBy(ctx.admin.saves, "http"))}.`,
    "- Times in tables are ms on the generator's monotonic clock relative to the anchor named in each heading; `capturedAt` (DB clock) and `servedAt` (function clock) are verbatim. `x-vercel-id` is per request, not per instance (instance ids are only in the `[liveSnapshot] build … instance=` log lines).",
    "",
    "| race | verdict |",
    "|---|---|",
    ...results.map((r) => `| ${r.title} | ${r.ok ? "PASS" : "FAIL"} |`),
    "",
    ...results.flatMap((r) => [
      `## ${r.title}`,
      "",
      r.what,
      "",
      r.verdict,
      "",
      r.summary,
      "",
      r.suspects?.length
        ? ["Suspected app bugs / findings (do not fix here — measurement only):", "", ...r.suspects.map((x) => `- ${x}`)].join("\n")
        : "Suspected app bugs: none from this race.",
      "",
      "<details><summary>Raw evidence</summary>",
      "",
      ...r.evidence.flatMap((e) => [e, ""]),
      "</details>",
      "",
    ]),
  ].join("\n");
  const mdPath = path.join(dir, `${stamp}-races.md`);
  fs.writeFileSync(mdPath, md);
  fs.writeFileSync(path.join(dir, `${stamp}-races.json`), JSON.stringify({ startedIso, scale: SCALE, base: BASE, saves: ctx.admin.saves, results: results.map(({ evidence, ...r }) => r) }, null, 1));
  console.log(`\nreport: ${mdPath}`);
  console.log(`event ${EVENT_ID}: rows ${rowsBefore} → ${rowsAfter}, leftovers ${leftAfter.length}`);
  if (rowsAfter !== rowsBefore || leftAfter.length) process.exitCode = 3;
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
}

main().catch(async (e) => {
  console.error(e);
  await closeDb();
  process.exit(1);
});
