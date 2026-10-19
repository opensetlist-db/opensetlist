// n15 fan-board rehearsal against the dev Preview. Writes only to event 109.
import fs from "node:fs";

const BASE = "https://opensetlist-gzwu0qdmq-opensetlist-projects.vercel.app";
const OUT = "C:/Users/cheon/AppData/Local/Temp/claude/F--work-ClaudeCode-opensetlist--claude-worktrees-sweet-perlman-669fab/ba358779-5838-48b9-baa9-7cc7dbad7ca5/scratchpad/rehearsal";
const EVENT = 109;
const STAMP = Date.now().toString(36);
const anon = {
  A: `rehearsal-A-${STAMP}`,
  B: `rehearsal-B-${STAMP}`,
  C: `rehearsal-C-${STAMP}`,
  D: `rehearsal-D-${STAMP}`,
  E: `rehearsal-E-${STAMP}`,
};
const log = [];        // every request
const results = [];    // step | expectation | observed | latency | PASS/FAIL
const rows = { picks: [], wishes: [] }; // ids left on dev 109 at the end

function note(step, expectation, observed, latency, pass) {
  results.push({ step, expectation, observed, latency, pass: pass ? "PASS" : "FAIL" });
}

async function call(label, method, path, { body, headers } = {}) {
  const t0 = performance.now();
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(headers ?? {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const ms = Math.round(performance.now() - t0);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  log.push({ label, method, path, body, headers, status: res.status, json, ms, at: new Date().toISOString() });
  return { status: res.status, json, ms };
}
const pick = (a, groupId, songId, extra) => call(`pick ${a}:${groupId}/${songId}`, "POST", `/api/events/${EVENT}/board/picks`, { body: { groupId: String(groupId), songId: String(songId), anonId: anon[a], ...extra } });
const wish = (a, groupId, songId) => call(`wish ${a}:${groupId}/${songId}`, "POST", `/api/events/${EVENT}/wishes`, { body: { groupId: String(groupId), songId: String(songId), anonId: anon[a] } });
const mine = (a) => call(`mine ${a}`, "GET", `/api/events/${EVENT}/board/mine?locale=ja`, { headers: { "OpenSetlist-Anon-Token": anon[a] } });
const delPick = (a, pickId) => call(`delete pick ${pickId} as ${a}`, "DELETE", `/api/events/${EVENT}/board/picks/${pickId}`, { body: { anonId: anon[a] } });
const publish = (a, picks) => call(`publish ${a}`, "PUT", `/api/events/${EVENT}/board/picks`, { body: { anonId: anon[a], picks: picks.map(([g, s]) => ({ groupId: String(g), songId: String(s) })) } });
const board = () => call("board aggregate", "GET", `/api/events/${EVENT}/board?locale=ja`);
const obs = (r) => `${r.status} ${JSON.stringify(r.json)}`;

// Songs per group (from the page's availableSongs catalog; 4600 is a
// crossover credited to groups 1/62/78/94).
const S = {
  1: { a: 69, b: 374, c: 81, d: 10, e: 420, x: 4600 },
  24: { a: 573, b: 652, c: 744, d: 616, e: 587, f: 5124 },
  78: { a: 2503, b: 2691, c: 2568, d: 2573 },
};

const main = async () => {
  const before = await board();
  const asOfBefore = before.json.asOf;
  console.log("asOf before:", asOfBefore);

  // ---------- Step 1: picks for anon A in group 1 ----------
  let r;
  const aPicks = {};
  for (const s of [S[1].a, S[1].b, S[1].x]) {
    r = await pick("A", 1, s);
    note("1 pick add", `201 new pick (group 1, song ${s})`, obs(r), r.ms, r.status === 201 && r.json.songId === String(s));
    if (r.status === 201) aPicks[s] = r.json;
  }
  r = await pick("A", 1, S[1].c);
  note("1 pick 4th", "409 cap_reached", obs(r), r.ms, r.status === 409 && r.json.error === "cap_reached");
  r = await pick("A", 1, S[1].a);
  note("1 pick re-add", `200 idempotent, same id ${aPicks[S[1].a]?.id}`, obs(r), r.ms, r.status === 200 && r.json.id === aPicks[S[1].a]?.id);
  r = await pick("A", 78, S[1].x);
  note("1 pick same song other group", "409 group_conflict (route doc; task said 'reassign')", obs(r), r.ms, r.status === 409 && r.json.error === "group_conflict");
  r = await pick("A", 1, S[24].a);
  note("1 pick song outside group", "400 song_outside_group", obs(r), r.ms, r.status === 400 && r.json.error === "song_outside_group");
  r = await call("pick missing anonId", "POST", `/api/events/${EVENT}/board/picks`, { body: { groupId: "1", songId: String(S[1].d) } });
  note("1 pick missing anonId", "400 invalid_anon_id", obs(r), r.ms, r.status === 400 && r.json.error === "invalid_anon_id");
  r = await call("pick empty anonId", "POST", `/api/events/${EVENT}/board/picks`, { body: { groupId: "1", songId: String(S[1].d), anonId: "" } });
  note("1 pick empty anonId", "400 invalid_anon_id", obs(r), r.ms, r.status === 400 && r.json.error === "invalid_anon_id");
  r = await call("pick unknown event", "POST", `/api/events/99999999/board/picks`, { body: { groupId: "1", songId: String(S[1].d), anonId: anon.A } });
  note("1 pick unknown event", "404 not_found", obs(r), r.ms, r.status === 404 && r.json.error === "not_found");
  r = await call("pick group not on board", "POST", `/api/events/${EVENT}/board/picks`, { body: { groupId: "99999", songId: String(S[1].d), anonId: anon.A } });
  note("1 pick group not on board", "400 invalid_group", obs(r), r.ms, r.status === 400 && r.json.error === "invalid_group");
  r = await call("pick malformed group", "POST", `/api/events/${EVENT}/board/picks`, { body: { groupId: "abc", songId: String(S[1].d), anonId: anon.A } });
  note("1 pick malformed group", "400 invalid_group", obs(r), r.ms, r.status === 400 && r.json.error === "invalid_group");

  // ---------- Step 2: wishes for anon A in group 24 ----------
  const aWishes = {};
  for (const s of [S[24].a, S[24].b, S[24].c]) {
    r = await wish("A", 24, s);
    note("2 wish add", `201 new wish (group 24, song ${s})`, obs(r), r.ms, r.status === 201 && r.json.songId === String(s));
    if (r.status === 201) aWishes[s] = r.json;
  }
  r = await wish("A", 24, S[24].d);
  note("2 wish 4th", "409 cap_reached", obs(r), r.ms, r.status === 409 && r.json.error === "cap_reached");
  r = await wish("A", 24, S[24].a);
  note("2 wish duplicate", `200 idempotent, same id ${aWishes[S[24].a]?.id}`, obs(r), r.ms, r.status === 200 && r.json.id === aWishes[S[24].a]?.id);
  r = await call("wish without anonId", "POST", `/api/events/${EVENT}/wishes`, { body: { groupId: "24", songId: String(S[24].d) } });
  note("2 wish without anonId", "400 invalid_anon_id", obs(r), r.ms, r.status === 400 && r.json.error === "invalid_anon_id");
  r = await call("wish without groupId", "POST", `/api/events/${EVENT}/wishes`, { body: { songId: S[24].d, anonId: anon.A } });
  note("2 wish without groupId", "400 invalid_group", obs(r), r.ms, r.status === 400 && r.json.error === "invalid_group");
  r = await call("wish legacy shape (songId number only)", "POST", `/api/events/${EVENT}/wishes`, { body: { songId: S[24].d } });
  note("2 wish legacy body {songId}", "400 (board event refuses legacy shape)", obs(r), r.ms, r.status === 400);

  // ---------- Step 3: /mine ----------
  r = await mine("A");
  const aPickIds = Object.values(aPicks).map((p) => p.id).sort();
  const aWishIds = Object.values(aWishes).map((w) => w.id).sort();
  const gotPicks = (r.json.picks ?? []).map((p) => p.id).sort();
  const gotWishes = (r.json.wishes ?? []).map((w) => w.id).sort();
  note("3 mine A", `exactly picks ${JSON.stringify(aPickIds)} and wishes ${JSON.stringify(aWishIds)}`,
    `${r.status} picks=${JSON.stringify(r.json.picks?.map((p) => [p.groupId, p.songId, p.title]))} wishes=${JSON.stringify(r.json.wishes?.map((w) => [w.groupId, w.songId, w.title]))}`,
    r.ms, r.status === 200 && JSON.stringify(gotPicks) === JSON.stringify(aPickIds) && JSON.stringify(gotWishes) === JSON.stringify(aWishIds));
  r = await mine("B");
  note("3 mine B", "200 { picks: [], wishes: [] }", obs(r), r.ms, r.status === 200 && r.json.picks?.length === 0 && r.json.wishes?.length === 0);
  r = await call("mine anonId in query", "GET", `/api/events/${EVENT}/board/mine?locale=ja&anonId=${anon.A}`, { headers: { "OpenSetlist-Anon-Token": anon.A } });
  note("3 mine anonId in query", "400 anon_in_query", obs(r), r.ms, r.status === 400 && r.json.error === "anon_in_query");

  // ---------- Step 4: delete ownership ----------
  const victim = aPicks[S[1].b].id;
  r = await delPick("B", victim);
  note("4 delete A's pick as B", "403 not_owner", obs(r), r.ms, r.status === 403 && r.json.error === "not_owner");
  r = await delPick("A", victim);
  note("4 delete A's pick as A", `200 { id: ${victim} }`, obs(r), r.ms, r.status === 200 && r.json.id === victim);
  r = await mine("A");
  note("4 mine A after delete", `2 picks (songs ${S[1].a}, ${S[1].x}), 3 wishes`, `${r.status} picks=${JSON.stringify(r.json.picks?.map((p) => p.songId))} wishes=${r.json.wishes?.length}`, r.ms,
    r.status === 200 && r.json.picks?.length === 2 && !r.json.picks.some((p) => p.id === victim) && r.json.wishes?.length === 3);
  r = await delPick("A", victim);
  note("4 delete again (retry)", "404 pick_not_found", obs(r), r.ms, r.status === 404 && r.json.error === "pick_not_found");
  delete aPicks[S[1].b];

  // ---------- Step 5: publish for anon B ----------
  const set1 = [[1, S[1].a], [1, S[1].d], [24, S[24].a], [24, S[24].b], [24, S[24].c]];
  r = await publish("B", set1);
  const pub1 = r.json.picks ?? [];
  note("5 publish set1 (2 groups, 2+3 songs)", "200 with 5 picks", `${r.status} ${JSON.stringify(pub1.map((p) => [p.groupId, p.songId]))}`, r.ms, r.status === 200 && pub1.length === 5);
  const keep69 = pub1.find((p) => p.songId === String(S[1].a));
  const keep573 = pub1.find((p) => p.songId === String(S[24].a));
  await new Promise((res) => setTimeout(res, 1200)); // make createdAt differences visible
  const set2 = [[1, S[1].a], [24, S[24].a], [78, S[78].a]];
  r = await publish("B", set2);
  const pub2 = r.json.picks ?? [];
  const r69 = pub2.find((p) => p.songId === String(S[1].a));
  const r573 = pub2.find((p) => p.songId === String(S[24].a));
  note("5 publish set2 (changed)", "200, 3 picks; 69 & 573 keep id+createdAt; 10/652/744 gone; 2503 new",
    `${r.status} ${JSON.stringify(pub2.map((p) => [p.groupId, p.songId, p.id === keep69?.id || p.id === keep573?.id ? "retained" : "new", p.createdAt]))}`, r.ms,
    r.status === 200 && pub2.length === 3 && r69?.id === keep69?.id && r69?.createdAt === keep69?.createdAt && r573?.id === keep573?.id && r573?.createdAt === keep573?.createdAt && pub2.some((p) => p.songId === String(S[78].a)));
  r = await mine("B");
  const mineB = (r.json.picks ?? []);
  note("5 mine B after set2", "same 3 rows, retained createdAt", `${r.status} ${JSON.stringify(mineB.map((p) => [p.groupId, p.songId, p.createdAt]))}`, r.ms,
    r.status === 200 && mineB.length === 3 && mineB.find((p) => p.songId === String(S[1].a))?.createdAt === keep69?.createdAt && !mineB.some((p) => p.songId === String(S[1].d)));
  r = await publish("B", [[1, S[1].a], [1, S[1].a]]);
  note("5 publish duplicate entry", "400 duplicate_song (nothing written)", obs(r), r.ms, r.status === 400 && r.json.error === "duplicate_song");
  r = await publish("B", [[1, S[1].a], [78, S[1].a]]);
  note("5 publish same song two groups", "400 duplicate_song", obs(r), r.ms, r.status === 400 && r.json.error === "duplicate_song");
  r = await publish("B", [[1, S[1].a], [1, S[1].b], [1, S[1].c], [1, S[1].d]]);
  note("5 publish 4 in one group", "409 cap_reached", obs(r), r.ms, r.status === 409 && r.json.error === "cap_reached");
  r = await mine("B");
  note("5 mine B unchanged after refused publishes", "still 3 picks", `${r.status} ${r.json.picks?.length} picks`, r.ms, r.status === 200 && r.json.picks?.length === 3);
  r = await publish("B", []);
  note("5 publish [] clears", "200 { picks: [] }", obs(r), r.ms, r.status === 200 && Array.isArray(r.json.picks) && r.json.picks.length === 0);
  r = await mine("B");
  note("5 mine B after clear", "empty", obs(r), r.ms, r.status === 200 && r.json.picks?.length === 0);

  // ---------- Step 7: realistic dataset (anons A, C, D, E) ----------
  // Target counts — group 1 expects: 69×3, 374×2, 4600×1, 81×1
  //                 group 1 wishes : 10×3, 420×2, 374×1
  //                 group 24 wishes: 573×3, 652×2, 744×1
  //                 group 24 expects: 616×3, 587×2, 5124×1
  //                 group 78 expects: 2503×3, 2691×2, 2568×1
  //                 group 78 wishes : 2573×3, 2503×1
  const plan = [
    ["C", "pick", 1, S[1].a], ["C", "pick", 1, S[1].b], ["C", "pick", 1, S[1].c],
    ["D", "pick", 1, S[1].a], ["D", "pick", 1, S[1].b],
    ["C", "wish", 1, S[1].d], ["C", "wish", 1, S[1].e],
    ["D", "wish", 1, S[1].d],
    ["E", "wish", 1, S[1].d], ["E", "wish", 1, S[1].e], ["E", "wish", 1, S[1].b],
    ["C", "wish", 24, S[24].a], ["C", "wish", 24, S[24].b],
    ["D", "wish", 24, S[24].a],
    ["C", "pick", 24, S[24].d], ["C", "pick", 24, S[24].e],
    ["D", "pick", 24, S[24].d],
    ["E", "pick", 24, S[24].d], ["E", "pick", 24, S[24].e], ["E", "pick", 24, S[24].f],
    ["C", "pick", 78, S[78].a], ["C", "pick", 78, S[78].b], ["C", "pick", 78, S[78].c],
    ["D", "pick", 78, S[78].a], ["D", "pick", 78, S[78].b],
    ["E", "pick", 78, S[78].a],
    ["C", "wish", 78, S[78].d],
    ["D", "wish", 78, S[78].d], ["D", "wish", 78, S[78].a],
    ["E", "wish", 78, S[78].d],
  ];
  let okCount = 0;
  const lat = [];
  for (const [a, kind, g, s] of plan) {
    r = kind === "pick" ? await pick(a, g, s) : await wish(a, g, s);
    lat.push(r.ms);
    if (r.status === 201) { okCount++; rows[kind === "pick" ? "picks" : "wishes"].push({ anon: anon[a], group: g, songId: s, id: r.json.id }); }
    else log.push({ label: `DATASET FAILURE ${a} ${kind} ${g}/${s}`, status: r.status, json: r.json });
  }
  note("7 dataset writes", `${plan.length} × 201`, `${okCount}/${plan.length} created`, `${Math.min(...lat)}–${Math.max(...lat)} (avg ${Math.round(lat.reduce((x, y) => x + y, 0) / lat.length)})`, okCount === plan.length);
  for (const p of Object.values(aPicks)) rows.picks.push({ anon: anon.A, group: 1, songId: Number(p.songId), id: p.id });
  for (const w of Object.values(aWishes)) rows.wishes.push({ anon: anon.A, group: 24, songId: Number(w.songId), id: w.id });

  // ---------- Step 6: aggregate after the TTL ----------
  const expected = {
    1: { expects: { [S[1].a]: 3, [S[1].b]: 2 }, expectsSubs: 7, expectsParts: 3, wishes: { [S[1].d]: 3, [S[1].e]: 2, [S[1].b]: 1 }, wishesSubs: 6, wishesParts: 3 },
    24: { expects: { [S[24].d]: 3, [S[24].e]: 2, [S[24].f]: 1 }, expectsSubs: 6, expectsParts: 3, wishes: { [S[24].a]: 3, [S[24].b]: 2, [S[24].c]: 1 }, wishesSubs: 6, wishesParts: 3 },
    78: { expects: { [S[78].a]: 3, [S[78].b]: 2, [S[78].c]: 1 }, expectsSubs: 6, expectsParts: 3, wishes: { [S[78].d]: 3, [S[78].a]: 1 }, wishesSubs: 4, wishesParts: 3 },
  };
  let after = null;
  const pollStart = Date.now();
  while (Date.now() - pollStart < 200_000) {
    const b = await board();
    const g1 = b.json.groups?.find((g) => g.groupId === "1");
    if (b.json.asOf !== asOfBefore && g1?.expects.submissions > 0) { after = b; break; }
    console.log("poll", new Date().toISOString(), "asOf", b.json.asOf, "g1 expects", g1?.expects.submissions);
    await new Promise((res) => setTimeout(res, 15_000));
  }
  if (!after) {
    note("6 aggregate asOf advanced", "asOf advances within ~3 min and shows writes", "did not advance / still empty", "-", false);
  } else {
    const asOfAfter = after.json.asOf;
    note("6 aggregate asOf advanced", `asOf > ${asOfBefore}`, `asOf ${asOfAfter}`, after.ms, asOfAfter > asOfBefore);
    for (const gid of ["1", "24", "78"]) {
      const g = after.json.groups.find((x) => x.groupId === gid);
      const e = expected[gid];
      const topE = Object.fromEntries(g.expects.top.map((t) => [t.songId, t.count]));
      const topW = Object.fromEntries(g.wishes.top.map((t) => [t.songId, t.count]));
      const okE = Object.entries(e.expects).every(([s, c]) => topE[s] === c) && g.expects.submissions === e.expectsSubs && g.expects.participants === e.expectsParts && g.expects.label === "early";
      const okW = Object.entries(e.wishes).every(([s, c]) => topW[s] === c) && g.wishes.submissions === e.wishesSubs && g.wishes.participants === e.wishesParts && g.wishes.label === "early";
      note(`6 group ${gid} ${g.name} expects`, `top ${JSON.stringify(e.expects)}, submissions ${e.expectsSubs}, participants ${e.expectsParts}, label early`,
        `top ${JSON.stringify(g.expects.top.map((t) => [t.songId, t.title, t.count]))}, submissions ${g.expects.submissions}, participants ${g.expects.participants}, label ${g.expects.label}`, after.ms, okE);
      note(`6 group ${gid} ${g.name} wishes`, `top ${JSON.stringify(e.wishes)}, submissions ${e.wishesSubs}, participants ${e.wishesParts}, label early`,
        `top ${JSON.stringify(g.wishes.top.map((t) => [t.songId, t.title, t.count]))}, submissions ${g.wishes.submissions}, participants ${g.wishes.participants}, label ${g.wishes.label}`, after.ms, okW);
    }
    for (const gid of ["44", "94", "62", "43", "84"]) {
      const g = after.json.groups.find((x) => x.groupId === gid);
      const ok = g.expects.label === "operator" && g.wishes.label === "operator" && g.expects.submissions === 0 && g.wishes.submissions === 0 && g.starters.length >= 2;
      note(`6 group ${gid} ${g.name} untouched`, "both columns operator, 0 submissions, starters present", `expects ${g.expects.label}/${g.expects.submissions}, wishes ${g.wishes.label}/${g.wishes.submissions}, starters ${g.starters.length}`, after.ms, ok);
    }
    fs.writeFileSync(`${OUT}/board109-after.json`, JSON.stringify(after.json, null, 1));
  }
  const d110 = await call("board 110 (read only)", "GET", `/api/events/110/board?locale=ja`);
  note("7 dev 110 untouched (read only)", "every group operator / 0 submissions", `${d110.status} ${JSON.stringify(d110.json.groups?.map((g) => [g.groupId, g.expects.submissions, g.wishes.submissions]))}`, d110.ms,
    d110.status === 200 && d110.json.groups?.every((g) => g.expects.submissions === 0 && g.wishes.submissions === 0));

  fs.writeFileSync(`${OUT}/api-log.json`, JSON.stringify({ anon, asOfBefore, asOfAfter: after?.json.asOf ?? null, results, rows, log }, null, 1));
  console.table(results.map((x) => ({ step: x.step, pass: x.pass, latency: x.latency })));
  console.log("FAILS:", results.filter((x) => x.pass === "FAIL").length, "of", results.length);
  console.log("anon ids:", JSON.stringify(anon));
};
main().catch((e) => { console.error(e); fs.writeFileSync(`${OUT}/api-log.json`, JSON.stringify({ anon, results, rows, log, error: String(e) }, null, 1)); process.exit(1); });
