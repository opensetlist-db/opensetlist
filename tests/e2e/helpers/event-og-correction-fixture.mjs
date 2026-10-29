import { config } from "dotenv";
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { installTypeScriptResolver } from "../../../scripts/ts-runtime.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
config({ path: [path.join(root, ".env.local"), path.join(root, ".env")], quiet: true });
function prior(action) {
  const run = spawnSync(process.execPath, [path.join(root, "tests/e2e/helpers/event-og-fixture.mjs"), action], {
    cwd: root, encoding: "utf8", timeout: 240_000, env: { ...process.env, EVENT_CARD_E2E_SUITE: "correction" },
  });
  if (run.status !== 0) throw new Error(run.stderr);
  return JSON.parse(run.stdout);
}
const action = process.argv[2];
if (action === "cleanup") console.log(JSON.stringify(prior("cleanup")));
else if (action === "prepare") {
  // The existing helper owns all DEV DB/bucket/test-namespace guards and
  // fixed-prefix fixture cleanup; keep one preparation path for actual PNGs.
  const original = prior("prepare"); installTypeScriptResolver(root);
  const load = (name) => import(pathToFileURL(path.join(root, name)).href);
  const { prisma } = await load("src/lib/prisma.ts");
  try {
    const { preparePreview } = await load("src/lib/eventOg/service.ts");
    const { readCardEvents } = await load("src/lib/eventOg/source.ts");
    const { publishPreview } = await load("src/lib/eventOg/publication.ts");
    await prisma.event.update({ where: { id: BigInt(original.eventId) }, data: { originalVenue: "Corrected development QA venue" } });
    const output = path.join(original.folder, "corrected-packet");
    const packet = await preparePreview({ root, output, events: await readCardEvents(prisma, [original.eventId]) });
    const revision = randomUUID(); const evidenceFile = path.join(original.folder, "fixture-approval.txt");
    const hash = (b) => createHash("sha256").update(b).digest("hex");
    const outputs = Object.fromEntries(packet.renditions.filter((r) => r.mode === "prediction").map((r) => [r.locale, packet.files.find((f) => f.file === r.file).sha256]));
    const approvalFile = path.join(original.folder, "corrected-approval.json");
    await writeFile(approvalFile, JSON.stringify({ kind: "owner-reviewed-event-card", eventId: original.eventId, mode: "prediction", previewId: packet.previewId,
      outputs, evidenceFile, evidenceSha256: hash(await readFile(evidenceFile)) }));
    const keys = ["ja", "ko", "en"].map((locale) => `test/event-cards/${original.eventId}/prediction/${revision}/${locale}.png`);
    await writeFile(path.join(original.folder, "corrected-keys.json"), JSON.stringify(keys, null, 2));
    console.error("[event-og-correction-e2e] retained keys", JSON.stringify(keys));
    const replacement = await publishPreview({ root, eventId: original.eventId, mode: "prediction", revision, manifestFile: path.join(output, "manifest.json"), approvalFile }, { origin: process.env.TEST_BASE_URL });
    const operationId = randomUUID(); const reasonFile = path.join(original.folder, "private-reason.txt");
    await writeFile(reasonFile, "Private synthetic QA venue correction reason");
    const result = { ...original, replacement, replacementHashes: outputs, operationId, reasonFile };
    await writeFile(path.join(original.folder, "correction-fixture.json"), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } finally { await prisma.$disconnect(); }
} else throw new Error("prepare or cleanup required");
