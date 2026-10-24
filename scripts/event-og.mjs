#!/usr/bin/env node
// Node 24's type stripping runs the shared TypeScript service. The resolver
// supplies the same extensionless local imports used by Next/Vitest.
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
    const candidate = new URL(`${specifier}.ts`, context.parentURL);
    if (existsSync(candidate)) return next(candidate.href, context);
  }
  return next(specifier, context);
} });

async function main() {
  const args = process.argv.slice(2);
  const action = args.shift();
  if (!["preview", "replay"].includes(action)) throw new Error("사용법: node scripts/event-og.mjs preview --events 109,7 --out <새 폴더> [--legacy-base http://127.0.0.1:3191] | replay --manifest <manifest.json> --out <새 폴더>");
  const options = {};
  while (args.length) {
    const key = args.shift();
    const value = args.shift();
    const allowed = action === "preview" ? ["--events", "--out", "--legacy-base", "--display-titles"] : ["--manifest", "--out"];
    if (!allowed.includes(key) || !value || value.startsWith("--") || options[key]) throw new Error(`잘못된 인자: ${key}`);
    options[key] = value;
  }
  if (!options["--out"]) throw new Error("출력 폴더가 필요합니다.");
  const output = path.resolve(options["--out"]);
  if (existsSync(output) || output.startsWith(path.join(root, "public") + path.sep) || output === path.join(root, "public")) throw new Error("기존 폴더나 public 경로에는 출력할 수 없습니다.");
  const { preparePreview, readPreview } = await import(pathToFileURL(path.join(root, "src/lib/eventOg/service.ts")).href);
  function report(manifest) {
    console.log(JSON.stringify({ previewId: manifest.previewId, manifest: path.join(output, "manifest.json"), gallery: path.join(output, "index.html"), originals: manifest.renditions.length, publication: "none" }, null, 2));
  }
  if (action === "replay") {
    if (!options["--manifest"]) throw new Error("manifest 파일이 필요합니다.");
    const { manifest, ...input } = await readPreview(options["--manifest"]);
    report(await preparePreview({ root, output, ...input, expectedPreviewId: manifest.previewId }));
    return;
  }
  const ids = options["--events"]?.split(",");
  if (!ids?.length || ids.some((id) => !/^[1-9]\d*$/.test(id)) || new Set(ids).size !== ids.length) throw new Error("올바른 공연 ID가 필요합니다.");
  let legacyBase;
  if (options["--legacy-base"]) {
    legacyBase = new URL(options["--legacy-base"]);
    if (legacyBase.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(legacyBase.hostname) || legacyBase.username || legacyBase.password || legacyBase.pathname !== "/" || legacyBase.search || legacyBase.hash) throw new Error("기존 OG 비교는 로컬 서버 origin만 허용합니다.");
  }
  // Reuse the repository's dev-only, extended-protocol READ ONLY transaction.
  // IDs are digits only; there is no writable Prisma/storage client here.
  const sql = `SELECT e.id::text, e.slug, e."originalName", e."originalLanguage", e.date, e."originalVenue", COALESCE((SELECT json_agg(t) FROM "EventTranslation" t WHERE t."eventId"=e.id), '[]') AS translations, CASE WHEN s.id IS NULL THEN NULL ELSE json_build_object('originalName',s."originalName",'originalLanguage',s."originalLanguage",'translations',COALESCE((SELECT json_agg(st) FROM "EventSeriesTranslation" st WHERE st."eventSeriesId"=s.id),'[]')) END AS "eventSeries", CASE WHEN a.id IS NULL THEN NULL ELSE json_build_object('originalName',a."originalName",'originalLanguage',a."originalLanguage",'translations',COALESCE((SELECT json_agg(at) FROM "ArtistTranslation" at WHERE at."artistId"=a.id),'[]')) END AS artist FROM "Event" e LEFT JOIN "EventSeries" s ON s.id=e."eventSeriesId" AND NOT s."isDeleted" LEFT JOIN "Artist" a ON a.id=e."artistId" AND NOT a."isDeleted" WHERE NOT e."isDeleted" AND e.id IN (${ids.join(",")}) ORDER BY e.id`;
  const result = JSON.parse(execFileSync(process.execPath, [path.join(root, "scripts/db-ro.mjs"), "--json", sql], { cwd: root, encoding: "utf8", timeout: 90_000, maxBuffer: 4 * 1024 * 1024, stdio: ["ignore", "pipe", "inherit"] }));
  const events = result[0].rows;
  if (events.length !== ids.length) throw new Error("선택한 공연이 없거나 삭제됐습니다.");
  // Stable row ordering makes content identity independent of query plan.
  for (const e of events) for (const item of [e, e.eventSeries, e.artist].filter(Boolean)) item.translations.sort((a, b) => a.locale.localeCompare(b.locale));
  const legacy = {};
  if (legacyBase) for (const e of events) for (const locale of ["ja", "ko", "en"]) {
    const response = await fetch(new URL(`/api/og/event/${e.id}?lang=${locale}&s=completed`, legacyBase), { signal: AbortSignal.timeout(60_000), redirect: "error" });
    if (!response.ok || !response.headers.get("content-type")?.startsWith("image/png") || response.headers.get("cache-control")?.includes("no-store")) throw new Error(`기존 OG 실패: ${e.id}/${locale}`);
    legacy[`${e.id}-${locale}`] = Buffer.from(await response.arrayBuffer());
  }
  const displayTitles = options["--display-titles"] ? JSON.parse(await readFile(options["--display-titles"], "utf8")) : [];
  if (!Array.isArray(displayTitles)) throw new Error("표시명 파일은 검토 항목 배열이어야 합니다.");
  const manifest = await preparePreview({ root, events, output, legacy, displayTitles });
  report(manifest);
}
main().catch((error) => { console.error(`event-og: ${error.message}`); process.exitCode = 1; });
