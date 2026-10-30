#!/usr/bin/env node
// Node 24's type stripping runs the shared TypeScript service. The resolver
// supplies the same extensionless local imports used by Next/Vitest.
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { installTypeScriptResolver } from "./ts-runtime.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
installTypeScriptResolver(root);

async function main() {
  const args = process.argv.slice(2);
  const action = args.shift();
  if (!["preview", "replay", "publish", "list", "correct", "suspend"].includes(action)) throw new Error("사용법: event-og.mjs preview | replay | publish | list | correct | suspend --event <id> --mode <모드> --revision <UUID> --expected-version <정수> --operation <작업UUID> --reason-file <운영사유파일>");
  const options = {};
  while (args.length) {
    const key = args.shift();
    const value = args.shift();
    const allowed = { preview: ["--events", "--out", "--legacy-base", "--display-titles"], replay: ["--manifest", "--out"],
      publish: ["--event", "--mode", "--revision", "--manifest", "--approval"], list: ["--event"],
      correct: ["--event", "--mode", "--revision", "--replacement", "--expected-version", "--operation", "--reason-file"],
      suspend: ["--event", "--mode", "--revision", "--expected-version", "--operation", "--reason-file"] }[action];
    if (!allowed.includes(key) || !value || value.startsWith("--") || options[key]) throw new Error(`잘못된 인자: ${key}`);
    options[key] = value;
  }
  if (["publish", "list", "correct", "suspend"].includes(action)) {
    let correctionReason;
    if (!/^[1-9]\d*$/.test(options["--event"] ?? "")) throw new Error("올바른 공연 ID가 필요합니다.");
    if (action === "publish" && (!options["--manifest"] || !options["--approval"] || !options["--revision"]
      || !["prediction", "live", "setlist"].includes(options["--mode"]))) throw new Error("발행에는 명시적 mode/revision/manifest/approval이 필요합니다.");
    if (["correct", "suspend"].includes(action) && (!options["--revision"] || (action === "correct" && !options["--replacement"]) || !options["--operation"] || !options["--reason-file"]
      || !/^(0|[1-9]\d*)$/.test(options["--expected-version"] ?? "") || !["prediction", "live", "setlist"].includes(options["--mode"]))) {
      throw new Error(action === "correct" ? "정정에는 명시적 mode/revision/replacement/expected-version/operation/reason-file이 필요합니다."
        : "공개 중단에는 명시적 mode/revision/expected-version/operation/reason-file이 필요합니다.");
    }
    if (["correct", "suspend"].includes(action)) {
      try {
        correctionReason = new TextDecoder("utf-8", { fatal: true }).decode(await readFile(path.resolve(options["--reason-file"])));
      } catch (error) {
        if (error instanceof TypeError) throw new Error("운영 사유 파일은 유효한 UTF-8이어야 합니다.");
        throw error;
      }
      if (correctionReason.includes("\u0000")) throw new Error("운영 사유 파일에 NUL 문자를 사용할 수 없습니다. UTF-8 인코딩을 확인하세요.");
    }
    const { config } = await import("dotenv");
    config({ path: [path.join(root, ".env.local"), path.join(root, ".env")], quiet: true });
    const { pointsAtDevProject } = await import("./dev-db-guard.mjs");
    for (const name of ["DATABASE_URL", "DATABASE_URL_UNPOOLED"]) if (!pointsAtDevProject(process.env[name] ?? "")) throw new Error("이 CLI는 dev 데이터베이스만 허용합니다.");
    const configuredOrigin = process.env.NEXT_PUBLIC_BASE_URL?.trim();
    if (!configuredOrigin) throw new Error("NEXT_PUBLIC_BASE_URL에 dev/Preview 공개 origin을 명시해야 합니다.");
    const origin = new URL(configuredOrigin);
    if (["opensetlist.com", "www.opensetlist.com", "opensetlist.vercel.app"].includes(origin.hostname)) throw new Error("운영 origin으로는 dev 발행본을 생성하거나 조회할 수 없습니다.");
    if (["publish", "suspend"].includes(action) && (process.env.R2_BUCKET !== "opensetlist-images-dev" || !["dev", "test"].includes(process.env.R2_KEY_PREFIX ?? ""))) {
      throw new Error("운영 발행은 허용하지 않습니다. dev bucket과 dev/test 저장소 namespace가 필요합니다.");
    }
    const lifecycle = await import(pathToFileURL(path.join(root, "src/lib/eventOg/index.ts")).href);
    const { prisma } = await import(pathToFileURL(path.join(root, "src/lib/prisma.ts")).href);
    try {
      if (action === "list") console.log(JSON.stringify({ publications: await lifecycle.listPublications(options["--event"]) }, null, 2));
      else if (action === "suspend") {
        const result = await lifecycle.suspendPublication({ eventId: options["--event"], mode: options["--mode"], revision: options["--revision"],
          expectedVersion: Number(options["--expected-version"]), operationId: options["--operation"], reason: correctionReason }, { origin: configuredOrigin });
        console.log(JSON.stringify(result, null, 2));
        if (result.status === "partial") process.exitCode = 1;
      }
      else if (action === "correct") {
        const result = await lifecycle.correctPublication({ eventId: options["--event"], mode: options["--mode"], revision: options["--revision"],
          replacementId: options["--replacement"], expectedVersion: Number(options["--expected-version"]), operationId: options["--operation"],
          reason: correctionReason }, { origin: configuredOrigin });
        console.log(JSON.stringify(result, null, 2));
      }
      else {
        const result = await lifecycle.publishPreview({ root, eventId: options["--event"], mode: options["--mode"], revision: options["--revision"],
          manifestFile: path.resolve(options["--manifest"]), approvalFile: path.resolve(options["--approval"]) }, { origin: configuredOrigin });
        console.log(JSON.stringify(result, null, 2));
      }
    } finally { await prisma.$disconnect(); }
    return;
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
  const sql = `SELECT e.id::text, e.slug, e."originalName", e."originalLanguage", e.date, e."originalVenue",
    COALESCE((SELECT json_agg(json_build_object('locale',t.locale,'name',t.name,'venue',t.venue))
      FROM "EventTranslation" t WHERE t."eventId"=e.id), '[]') AS translations,
    CASE WHEN s.id IS NULL THEN NULL ELSE json_build_object('originalName',s."originalName",'originalLanguage',s."originalLanguage",
      'translations',COALESCE((SELECT json_agg(json_build_object('locale',st.locale,'name',st.name))
        FROM "EventSeriesTranslation" st WHERE st."eventSeriesId"=s.id),'[]')) END AS "eventSeries",
    CASE WHEN a.id IS NULL THEN NULL ELSE json_build_object('originalName',a."originalName",'originalLanguage',a."originalLanguage",
      'translations',COALESCE((SELECT json_agg(json_build_object('locale',at.locale,'name',at.name))
        FROM "ArtistTranslation" at WHERE at."artistId"=a.id),'[]')) END AS artist
    FROM "Event" e LEFT JOIN "EventSeries" s ON s.id=e."eventSeriesId" AND NOT s."isDeleted"
    LEFT JOIN "Artist" a ON a.id=e."artistId" AND NOT a."isDeleted"
    WHERE NOT e."isDeleted" AND e.id IN (${ids.join(",")}) ORDER BY e.id`;
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
