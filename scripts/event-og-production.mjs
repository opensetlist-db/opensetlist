#!/usr/bin/env node
// Hosted, explicitly owner-dispatched operations only. Never load local env
// files or weaken the existing dev CLI's database/storage guards.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { createHash } from "node:crypto";
import { installTypeScriptResolver } from "./ts-runtime.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
installTypeScriptResolver(root);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const load = (file) => import(pathToFileURL(path.join(root, "src/lib/eventOg", file)).href);
let artifactFolder;
async function main() {
  if (!["verify", "execute"].includes(process.argv[2]) || process.argv.length !== 3) throw new Error("operation_arguments");
  const { productionOperation, assertProductionDeployment, assertPreviewRun, assertProductionStorage, assertEnvironmentPolicy, publicOperationResult } = await load("productionOperation.ts");
  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, "utf8"));
  const plan = productionOperation(process.env, event);
  const api = async (resource) => {
    if (!process.env.GITHUB_TOKEN) throw new Error("github_permission_required");
    const response = await fetch(`https://api.github.com/repos/opensetlist-db/opensetlist/${resource}`, {
      headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      redirect: "error", signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error("github_evidence_unavailable"); return response.json();
  };
  assertEnvironmentPolicy(await api("environments/EventCardProduction"),
    await api("environments/EventCardProduction/deployment-branch-policies?per_page=100"));
  const deployments = await api(`deployments?sha=${process.env.GITHUB_SHA}&environment=Production&per_page=100`);
  const deployment = deployments.find((d) => d.sha === process.env.GITHUB_SHA && d.environment === "Production" && d.creator?.login === "vercel[bot]");
  if (!deployment) throw new Error("production_deployment_required");
  const statuses = await api(`deployments/${deployment.id}/statuses?per_page=1`);
  const deployedOrigin = assertProductionDeployment(process.env.GITHUB_SHA, deployment, statuses[0]);
  if (plan.action === "publish") assertPreviewRun(process.env.GITHUB_SHA,
    await api(`actions/runs/${plan.previewRunId}/attempts/${plan.previewRunAttempt}`), plan.previewRunAttempt);
  if (process.argv[2] === "verify") { console.log(JSON.stringify({ verified: true, action: plan.action, commit: process.env.GITHUB_SHA, deployedOrigin })); return; }

  artifactFolder = path.join(process.env.RUNNER_TEMP, "event-card-artifacts"); await mkdir(artifactFolder);
  const folder = path.join(process.env.RUNNER_TEMP, "event-card-ops");
  const { openPreviewArchive, sealPreviewDirectory } = await load("previewArchive.ts");
  if (plan.action === "publish") await openPreviewArchive(path.join(process.env.RUNNER_TEMP, "event-card-input/preview.enc"), folder, process.env.EVENT_CARD_PREVIEW_ENCRYPTION_KEY);
  else await mkdir(folder);
  const resultFile = path.join(folder, "operation-result.json");
  const evidenceFile = path.join(folder, "owner-selection.json");
  const selection = { actor: process.env.GITHUB_ACTOR, triggeringActor: process.env.GITHUB_TRIGGERING_ACTOR, action: plan.action,
    commit: process.env.GITHUB_SHA, eventIds: plan.eventIds, mode: plan.mode, revision: plan.revision,
    previewRunId: plan.previewRunId, previewRunAttempt: plan.previewRunAttempt, approvedManifestSha256: plan.manifestSha256, displayTitles: plan.displayTitles,
    deliveryProofSha256: process.env.EVENT_CARD_DELIVERY_PROOF_SHA256 ?? null, performedAt: new Date().toISOString(),
    runUrl: `https://github.com/opensetlist-db/opensetlist/actions/runs/${process.env.GITHUB_RUN_ID}` };
  await writeFile(path.join(folder, `attempt-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}.json`), JSON.stringify(selection, null, 2));
  // Keep the downloaded preview's display-title evidence at its original
  // absolute runner path. Changing evidence bytes/paths changes preview identity.
  if (plan.action !== "publish") await writeFile(evidenceFile, JSON.stringify(selection, null, 2));
  const { prisma: db } = await import(pathToFileURL(path.join(root, "src/lib/prisma.ts")).href);
  try {
    const { readCardEvents } = await load("source.ts");
    const snapshot = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const rows = await tx.event.findMany({ where: { id: { in: plan.eventIds.map(BigInt) } }, select: { id: true, slug: true } });
      if (rows.length !== plan.eventIds.length || rows.some((e) => !plan.targets.some((t) => t.id === String(e.id) && t.slug === e.slug))) throw new Error("fes2_target_changed");
      return plan.action === "preview" ? readCardEvents(tx, plan.eventIds) : null;
    }, { maxWait: 30000, timeout: 30000 });
    let result;
    if (plan.action === "preview") {
      if (snapshot.length !== plan.eventIds.length) throw new Error("deleted_preview_target");
      const { preparePreview } = await load("service.ts");
      const reviewSha256 = sha(await readFile(evidenceFile));
      const manifest = await preparePreview({ root, events: snapshot, output: path.join(folder, "packet"),
        displayTitles: plan.displayTitles.map((d) => ({ ...d, reviewFile: evidenceFile, reviewSha256 })) });
      result = { action: "preview", commit: process.env.GITHUB_SHA, deployedOrigin, eventIds: plan.eventIds, previewId: manifest.previewId,
        manifestSha256: sha(await readFile(path.join(folder, "packet/manifest.json"))), publication: "none", sourceEvents: snapshot };
    } else {
      const lifecycle = await load("index.ts"); const eventId = plan.eventIds[0];
      if (plan.action === "list") {
        // The operator reader also returns private reasons/audit internals.
        // Public Actions artifacts must contain only this explicit projection.
        const rows = await db.$transaction(async (tx) => { await tx.$executeRaw`SET TRANSACTION READ ONLY`; return lifecycle.listPublications(eventId, tx); });
        result = { action: "list", eventId, publications: rows.map((r) => ({ publicationId: r.publicationId, mode: r.mode,
          urls: r.urls, status: r.annotation?.status, version: r.annotation?.version })) };
      } else if (plan.action === "inspect") {
        result = { action: "inspect", ...await lifecycle.inspectPublication({ eventId, mode: plan.mode, revision: plan.revision, namespace: "prod" }) };
      } else if (plan.action === "publish") {
        const preview = JSON.parse(await readFile(resultFile, "utf8"));
        if (preview.action !== "preview" || preview.commit !== process.env.GITHUB_SHA || !preview.eventIds.includes(eventId)) throw new Error("preview_artifact_mismatch");
        const manifestFile = path.join(folder, "packet/manifest.json"); const bytes = await readFile(manifestFile);
        if (sha(bytes) !== plan.manifestSha256) throw new Error("approved_manifest_mismatch");
        const manifest = JSON.parse(bytes.toString("utf8"));
        for (const rendition of manifest.renditions) {
          const review = rendition.content?.displayTitle;
          if (review && review.reviewFile !== evidenceFile) throw new Error("display_review_path_mismatch");
        }
        const selected = manifest.renditions.filter((r) => r.eventId === eventId && r.mode === plan.mode);
        const outputs = Object.fromEntries(selected.map((r) => [r.locale, manifest.files.find((f) => f.file === r.file && f.role === "original")?.sha256]));
        const approvalFile = path.join(folder, "publication-approval.json");
        // Retries must produce identical approval bytes: current run/time or
        // mutable delivery configuration would change the publication fingerprint.
        const approval = { actor: process.env.GITHUB_ACTOR, commit: process.env.GITHUB_SHA, eventId, mode: plan.mode, revision: plan.revision,
          previewRunId: plan.previewRunId, previewRunAttempt: plan.previewRunAttempt, approvedManifestSha256: plan.manifestSha256, outputs };
        const publicationEvidence = path.join(folder, "publication-selection.json"); await writeFile(publicationEvidence, JSON.stringify(approval, null, 2));
        await writeFile(approvalFile, JSON.stringify({ kind: "owner-reviewed-event-card", eventId, mode: plan.mode,
          previewId: manifest.previewId, outputs, evidenceFile: publicationEvidence, evidenceSha256: sha(await readFile(publicationEvidence)) }));
        result = await lifecycle.publishPreview({ root, eventId, mode: plan.mode, revision: plan.revision, manifestFile, approvalFile }, { origin: "https://opensetlist.com" });
      } else {
        const input = { eventId, mode: plan.mode, revision: plan.revision, expectedVersion: plan.expectedVersion, operationId: plan.operationId,
          reason: process.env.EVENT_CARD_PRIVATE_REASON };
        const delivery = { async revoke(target) {
          assertProductionStorage(process.env);
          const { getCardDelivery } = await load("delivery.ts"); return getCardDelivery().revoke(target);
        } };
        result = plan.action === "correct" ? await lifecycle.correctPublication({ ...input, replacementId: plan.replacementId }, { origin: "https://opensetlist.com" })
          : await lifecycle.suspendPublication(input, { origin: "https://opensetlist.com", delivery });
      }
    }
    await writeFile(resultFile, JSON.stringify(result, null, 2));
    if (plan.action === "preview") {
      await sealPreviewDirectory(folder, path.join(artifactFolder, "preview.enc"), process.env.EVENT_CARD_PREVIEW_ENCRYPTION_KEY);
      await writeFile(path.join(artifactFolder, "summary.json"), JSON.stringify({ action: "preview", commit: result.commit, previewId: result.previewId,
        manifestSha256: result.manifestSha256, publication: "none", encrypted: true }, null, 2));
    } else await writeFile(path.join(artifactFolder, "operation-result.json"), JSON.stringify(publicOperationResult(plan, result), null, 2));
    console.log(JSON.stringify({ action: plan.action, resultFile, status: result.status ?? "prepared" }));
    if (result.status === "partial") process.exitCode = 1;
  } finally { await db.$disconnect(); }
}
main().catch(async (error) => {
  const known = new Set(["publication_conflict", "preview_stale", "outcome_unknown", "not_saved", "invalid_publication", "invalid_correction", "correction_conflict", "suspension_conflict",
    "operation_arguments", "github_permission_required", "github_evidence_unavailable", "production_deployment_required", "fes2_target_changed", "deleted_preview_target",
    "preview_artifact_mismatch", "approved_manifest_mismatch", "display_review_path_mismatch"]);
  const code = known.has(error?.code) ? error.code : known.has(error?.message) ? error.message : "operation_failed";
  if (artifactFolder) await writeFile(path.join(artifactFolder, "failure.json"), JSON.stringify({ status: "failed", code })).catch(() => {});
  console.error(JSON.stringify({ status: "failed", code, instruction: "실행 승인·대상·배포·설정을 확인하세요. 같은 발행/작업 식별자로 저장 결과를 확인한 뒤 재시도하세요." })); process.exitCode = 1;
});
