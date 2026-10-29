import { config } from "dotenv";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { pointsAtDevProject } from "../../../scripts/dev-db-guard.mjs";
import { installTypeScriptResolver } from "../../../scripts/ts-runtime.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
config({ path: [path.join(root, ".env.local"), path.join(root, ".env")], quiet: true });
if (process.env.EVENT_CARD_R2_E2E !== "1" || process.env.R2_BUCKET !== "opensetlist-images-dev" || process.env.R2_KEY_PREFIX !== "test") throw new Error("Explicit dev bucket/test E2E opt-in required");
for (const name of ["DATABASE_URL", "DATABASE_URL_UNPOOLED"]) if (!pointsAtDevProject(process.env[name] ?? "")) throw new Error("Dev DB required");
installTypeScriptResolver(root);
const { prisma: db } = await import(pathToFileURL(path.join(root, "src/lib/prisma.ts")).href);
const suite = process.env.EVENT_CARD_E2E_SUITE ?? "publication";
if (!["publication", "correction", "suspension", "rollout"].includes(suite)) throw new Error("Unknown event-card E2E suite");
const PREFIX = { publication: "og02e2e-", correction: "og03e2e-", suspension: "og04e2e-", rollout: "og05e2e-" }[suite];
const hash = (b) => createHash("sha256").update(b).digest("hex");
async function purge() {
  const ids = (await db.event.findMany({ where: { slug: { startsWith: PREFIX } }, select: { id: true } })).map((e) => e.id);
  const assets = await db.eventCardRendition.findMany({ where: { publication: { eventId: { in: ids } } }, select: { assetId: true } });
  const publications = await db.eventCardPublication.findMany({ where: { eventId: { in: ids } }, select: { id: true } });
  await db.eventCardSuspensionAttempt.deleteMany({ where: { suspension: { publicationId: { in: publications.map((p) => p.id) } } } });
  await db.eventCardSuspension.deleteMany({ where: { publicationId: { in: publications.map((p) => p.id) } } });
  await db.eventCardWriteAttempt.deleteMany({ where: { eventId: { in: ids } } });
  await db.eventCardCorrection.deleteMany({ where: { publication: { eventId: { in: ids } } } });
  await db.eventCardPublication.deleteMany({ where: { eventId: { in: ids } } });
  await db.imageAsset.deleteMany({ where: { id: { in: assets.map((a) => a.assetId) } } });
  await db.eventTranslation.deleteMany({ where: { eventId: { in: ids } } });
  await db.event.deleteMany({ where: { id: { in: ids } } });
  if (await db.event.count({ where: { slug: { startsWith: PREFIX } } })) throw new Error("Fixture cleanup incomplete");
}
try {
  const action = process.argv[2];
  if (action === "cleanup") { await purge(); console.log(JSON.stringify({ cleaned: true })); }
  else if (action === "deleted" || action === "restored") {
    const id = process.argv[3];
    if (!/^[1-9]\d*$/.test(id)) throw new Error("Invalid fixture ID");
    const result = await db.event.updateMany({ where: { id: BigInt(id), slug: { startsWith: PREFIX } }, data: { isDeleted: action === "deleted" } });
    if (result.count !== 1) throw new Error("Not this suite's fixture");
    console.log(JSON.stringify({ updated: true }));
  } else if (action === "prepare") {
    const { preparePreview } = await import(pathToFileURL(path.join(root, "src/lib/eventOg/service.ts")).href);
    const { readCardEvents } = await import(pathToFileURL(path.join(root, "src/lib/eventOg/source.ts")).href);
    const { publishPreview } = await import(pathToFileURL(path.join(root, "src/lib/eventOg/publication.ts")).href);
    const { getImageStorage } = await import(pathToFileURL(path.join(root, "src/lib/imageUpload/storage.ts")).href);
    await purge();
    const slug = `${PREFIX}${Date.now()}`;
    const row = await db.event.create({ data: { slug, originalName: "OpenSetlist QA event Day.1", originalLanguage: "en", type: "concert",
      startTime: new Date("2099-07-11T08:00:00Z"), date: new Date("2099-07-11T00:00:00Z"), originalVenue: "Development QA venue" } });
    const eventId = String(row.id); const folder = path.join(root, ".claude/tmp", slug); await mkdir(folder, { recursive: true });
    const manifestFile = path.join(folder, "packet/manifest.json");
    const manifest = await preparePreview({ root, events: await readCardEvents(db, [eventId]), output: path.dirname(manifestFile) });
    const evidenceFile = path.join(folder, "fixture-approval.txt");
    await writeFile(evidenceFile, "Synthetic QA publication: dev only. Owner-authorized ticket02 verification; no production approval.");
    const storage = getImageStorage(); const published = [];
    const publishMode = async (mode, manifest, manifestFile, label = mode) => {
      const revision = randomUUID(); const approvalFile = path.join(folder, `${label}-approval.json`);
      const outputs = Object.fromEntries(manifest.renditions.filter((r) => r.mode === mode).map((r) => [r.locale, manifest.files.find((f) => f.file === r.file).sha256]));
      await writeFile(approvalFile, JSON.stringify({ kind: "owner-reviewed-event-card", eventId, mode, previewId: manifest.previewId, outputs, evidenceFile, evidenceSha256: hash(await readFile(evidenceFile)) }));
      const keys = ["ja", "ko", "en"].map((locale) => `test/event-cards/${eventId}/${mode}/${revision}/${locale}.png`);
      console.error("[event-og-e2e] retained keys", JSON.stringify(keys));
      await writeFile(path.join(folder, `${label}-keys.json`), JSON.stringify(keys, null, 2));
      const result = await publishPreview({ root, manifestFile, approvalFile, eventId, mode, revision }, { storage, origin: process.env.TEST_BASE_URL });
      return { mode, revision, urls: result.urls, hashes: outputs, approvalFile, manifestFile };
    };
    for (const mode of ["prediction", "live", "setlist"]) published.push(await publishMode(mode, manifest, manifestFile));
    if (suite === "rollout") {
      // A genuine source edit and freshly rendered/reviewed synthetic packet:
      // the older publication must retain the original venue/PNG afterward.
      await db.event.update({ where: { id: row.id }, data: { originalVenue: "Development QA corrected venue" } });
      const replacementFile = path.join(folder, "replacement-packet/manifest.json");
      const replacement = await preparePreview({ root, events: await readCardEvents(db, [eventId]), output: path.dirname(replacementFile) });
      published.push(await publishMode("prediction", replacement, replacementFile, "replacement"));
    }
    const result = { eventId, slug, folder, published };
    await writeFile(path.join(folder, "publications.json"), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } else throw new Error("Unknown fixture action");
} finally { await db.$disconnect(); }
