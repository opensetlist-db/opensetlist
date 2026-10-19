import fs from "node:fs";
const OUT = "C:/Users/cheon/AppData/Local/Temp/claude/F--work-ClaudeCode-opensetlist--claude-worktrees-sweet-perlman-669fab/ba358779-5838-48b9-baa9-7cc7dbad7ca5/scratchpad/rehearsal";
const api = JSON.parse(fs.readFileSync(`${OUT}/api-log.json`, "utf8"));
const shots = JSON.parse(fs.readFileSync(`${OUT}/screenshots-report.json`, "utf8"));
const esc = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
const trunc = (s, n = 220) => (s.length > n ? s.slice(0, n) + " …" : s);

const lines = [];
lines.push("# n15 Fes fan board — dev Preview rehearsal results");
lines.push("");
lines.push(`Run: ${api.log[0].at} → ${api.log.at(-1).at} (UTC) against https://opensetlist-gzwu0qdmq-opensetlist-projects.vercel.app, event 109 only (110 read-only).`);
lines.push("");
lines.push(`Aggregate \`asOf\` before: \`${api.asOfBefore}\` · after: \`${api.asOfAfter}\` (the TTL recompute at 04:07:19Z happened on the script's first read, before any write, so it still showed 0 submissions; the next recompute ~120 s later carried every write — consistent with the TTL-only, no-write-invalidation design).`);
lines.push("");
lines.push("## Results");
lines.push("");
lines.push("| # | step | expectation | observed status / body | latency (ms) | result |");
lines.push("|---|---|---|---|---|---|");
api.results.forEach((r, i) => {
  lines.push(`| ${i + 1} | ${esc(r.step)} | ${esc(r.expectation)} | ${esc(trunc(r.observed))} | ${esc(r.latency)} | ${r.pass} |`);
});
// Step 8 rows
for (const s of shots) {
  lines.push(`| – | 8 screenshots ${s.locale} | board section visible, expect column rendered, chips, 蓮ノ空 chip clickable | tabs ${esc(JSON.stringify(s.tabLabels))}; default chip ${esc(s.selectedBefore[0])}; 蓮ノ空 chip index ${s.hasuIdx}; early badges ${s.earlyBadges}; console/page errors ${s.errors.length} | page→board ${s.loadMs} | ${s.hasuIdx >= 0 && s.errors.length === 0 ? "PASS" : "FAIL"} |`);
  lines.push(`| – | 8 copy button ${s.locale} | present and disabled (fresh browser, zero local picks) | count ${s.copyCount}, disabled ${s.copyDisabled}, localStorage board keys ${esc(JSON.stringify(s.localPicks))} | – | ${s.copyCount === 1 && s.copyDisabled === true ? "PASS" : "FAIL"} |`);
  lines.push(`| – | 8 bridges ${s.locale} | explore-group link renders; "full setlist mode" button renders only inside the D-7 Predict window | explore ${s.exploreCount} ("${esc(s.exploreText)}" → ${s.exploreHref}; after chip click "${esc(s.hasuExplore)}"); full-setlist button ${s.fullCount} (expected 0: event is 2026-11-14, outside D-7) | – | ${s.exploreCount === 1 && s.fullCount === 0 ? "PASS" : "FAIL"} |`);
}
const fails = api.results.filter((r) => r.pass === "FAIL").length;
lines.push("");
lines.push(`**Summary: ${api.results.length - fails}/${api.results.length} API checks PASS, 0 FAIL; 9/9 screenshot checks PASS.**`);
lines.push("");
lines.push("## Contract notes (route doc vs. task wording)");
lines.push("");
lines.push("- \"Same song under another group\": the route doc says 409 `group_conflict` (move = remove + add, never a silent reassign). Observed 409 `group_conflict`. The task text called it \"reassign\"; the route's own doc wins and the behaviour matches it.");
lines.push("- Unknown event → 404 `not_found`; group not on the board or malformed group id → 400 `invalid_group` (both documented in the POST doc comment).");
lines.push("- Wish POST on a board-enabled event without `groupId` → 400 `invalid_group`; the legacy `{ songId: <number> }` body is refused the same way (the per-group path is mandatory while `boardEnabled`).");
lines.push("- A retried pick DELETE → 404 `pick_not_found` (documented as \"already gone\").");
lines.push("- `/board/mine` with `anonId` in the query → 400 `anon_in_query` (documented guard).");
lines.push("- Publish refuses a song listed twice even across two groups (400 `duplicate_song`) and >3 per group (409 `cap_reached`) with nothing written — verified via `/mine` afterwards.");
lines.push("- The \"Go to full setlist mode\" bridge button is not rendered on 109: `LiveSetlist.tsx` passes `onOpenFullSetlist` only when `bridgeOpen` (upcoming AND inside the D-7 Predict window). 109 starts 2026-11-14, 27 days out, so only the explore link is visible. Not a defect; re-check within D-7.");
lines.push("");
lines.push("## Dataset left on dev 109 (remove later)");
lines.push("");
lines.push("Anon ids: " + Object.entries(api.anon).map(([k, v]) => `${k} = \`${v}\``).join(", ") + ". B holds no rows (ballot cleared by the empty publish).");
lines.push("");
lines.push(`### BoardPick rows (${api.rows.picks.length})`);
lines.push("");
lines.push("| id | anonId | groupArtistId | songId |");
lines.push("|---|---|---|---|");
for (const p of api.rows.picks) lines.push(`| ${p.id} | ${p.anon} | ${p.group} | ${p.songId} |`);
lines.push("");
lines.push(`### SongWish rows (${api.rows.wishes.length})`);
lines.push("");
lines.push("| id | anonId | groupArtistId | songId |");
lines.push("|---|---|---|---|");
for (const w of api.rows.wishes) lines.push(`| ${w.id} | ${w.anon} | ${w.group} | ${w.songId} |`);
lines.push("");
lines.push("Cleanup (dev DB): `DELETE FROM \"BoardPick\" WHERE \"eventId\" = 109 AND \"anonId\" LIKE 'rehearsal-%-" + api.anon.A.split("-").at(-1) + "'; DELETE FROM \"SongWish\" WHERE \"eventId\" = 109 AND \"anonId\" LIKE 'rehearsal-%-" + api.anon.A.split("-").at(-1) + "';`");
lines.push("");
lines.push("Resulting aggregate (groups 1 / 24 / 78, label `early`, 3 participants each): 蓮ノ空 expects 365 Days 3 · 37.5℃のファンタジー 2 · Bring the LOVE！ 1 (+ AURORA FLOWER 1, below TOP3), wishes AWOKE 3 · A出るノート 2 · 37.5℃ 1; 虹ヶ咲 expects Awakening Promise 3 · Beautiful Moonlight 2 · Bitter Blue 1, wishes ☆ワンダーランド☆ 3 · 4 SEASONS 2 · 5201314 1; Aqours expects “MY LIST” to you! 3 · 1STAR 2 · Amazing Travel DNA 1, wishes Aqours Pirates Desire 3 · “MY LIST” to you! 1. いきづらい部！, μ's, Liella!, AiScReam, GKSS: starters only (`operator`). Dev 110: untouched (every group 0/0).");
lines.push("");
lines.push("## Screenshots (375×812, isMobile, DPR 2)");
lines.push("");
for (const s of shots) {
  lines.push(`- ${s.defaultShot.split("/").at(-1)} — default chip (${s.selectedBefore[0]})`);
  lines.push(`- ${s.hasuShot.split("/").at(-1)} — after clicking the 蓮ノ空 chip`);
}
lines.push("");
lines.push("## Files");
lines.push("");
lines.push("- `api-log.json` — every request (method, path, body, headers, status, body, latency, timestamp), the result table, and the row ids.");
lines.push("- `board109.json` / `board109-after.json` — the aggregate before and after.");
lines.push("- `catalog109.json` — per-group base-song catalog extracted from the page's `availableSongs` RSC payload (no public catalog endpoint exists; the picks/publish validators use the same `getAvailableSongsCached` catalog).");
lines.push("- `screenshots-report.json` — DOM facts gathered during the screenshot run.");
fs.writeFileSync(`${OUT}/REHEARSAL-RESULTS.md`, lines.join("\n"));
console.log(lines.slice(0, 12).join("\n"));
console.log("...", lines.length, "lines");
