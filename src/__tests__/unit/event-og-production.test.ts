// @vitest-environment node
import { describe, it, expect } from "vitest";
import { productionOperation, assertProductionDeployment, assertPreviewRun, assertEnvironmentPolicy, publicOperationResult } from "@/lib/eventOg/productionOperation";
import { spawnSync } from "node:child_process";

const revision = "1dcd9a25-4916-4ce7-9526-1e81c7ecfc3d";
function fixture(operation = "publish") {
  const project = "a".repeat(20);
  const env: Record<string, string | undefined> = { GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted", GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REPOSITORY: "opensetlist-db/opensetlist", GITHUB_REF: "refs/heads/main", GITHUB_ACTOR: "helloopensetlistdb", GITHUB_TRIGGERING_ACTOR: "helloopensetlistdb",
    GITHUB_WORKFLOW_REF: "opensetlist-db/opensetlist/.github/workflows/event-card-ops.yml@refs/heads/main", GITHUB_SHA: "c".repeat(40),
    EVENT_CARD_FES2_TARGETS: JSON.stringify([{ id: "109", slug: "fes2-day1" }, { id: "110", slug: "fes2-day2" }]), EVENT_CARD_PROD_PROJECT_REF: project,
    DATABASE_URL: `postgresql://postgres.${project}:synthetic@aws-1-ap-northeast-2.pooler.supabase.com:5432/postgres`,
    DATABASE_URL_UNPOOLED: `postgresql://postgres:synthetic@db.${project}.supabase.co:5432/postgres`,
    EVENT_CARD_PUBLICATION_ENABLED: "reviewed-delivery-paths", EVENT_CARD_DELIVERY_PROOF_SHA256: "e".repeat(64),
    EVENT_CARD_PREVIEW_ENCRYPTION_KEY: "d".repeat(64),
    R2_KEY_PREFIX: "prod", R2_BUCKET: "synthetic-production", EVENT_CARD_PROD_BUCKET: "synthetic-production", R2_PUBLIC_BASE_URL: "https://img.opensetlist.com" };
  const event = { ref: "main", sender: { login: "helloopensetlistdb" }, repository: { full_name: "opensetlist-db/opensetlist" },
    inputs: { operation, request: JSON.stringify({ eventId: "109", mode: "prediction", revision }), confirm: "APPROVE-FES2-CARD", preview_run_id: "123", preview_run_attempt: "1", approved_manifest_sha256: "f".repeat(64) } };
  return { env, event };
}
describe("owner-dispatched hosted production card boundary", () => {
  it("publishes only explicit result fields, with no private delivery/audit data even on partial suspension or recovery", () => {
    const urls = { ja: "https://opensetlist.com/ja/share/approved", ko: "https://opensetlist.com/ko/share/approved", en: "https://opensetlist.com/en/share/approved" };
    const privateFields = { privateReason: "private-reason-canary", operationId: "private-operation-canary", attemptId: "private-attempt-canary",
      report: { origins: [{ key: "private-object-key" }], cache: { prefixes: ["private-cache-prefix"] }, public: [{ url: "private-probe" }],
        unsettledWriters: ["private-writer-canary"], writersAtStart: ["private-start-canary"], writersAtEnd: ["private-end-canary"] } };
    const value = { status: "partial", safeNoticeApplied: true, version: 1, urls, ...privateFields };
    expect(JSON.stringify(value)).toContain("private-object-key");
    const plan = { action: "suspend" as const, eventIds: ["109"], mode: "prediction" as const, revision };
    const projected = publicOperationResult(plan, value);
    expect(projected).toMatchObject({ status: "partial", safeNoticeApplied: true, version: 1, urls, publicationId: revision });
    expect(JSON.stringify(projected)).not.toContain("private-");
    const inspection = publicOperationResult({ ...plan, action: "inspect" }, { outcome: "uncertain", unsettledWriters: ["private-writer-canary"], ...privateFields });
    expect(inspection).toMatchObject({ outcome: "uncertain", unsettledWriterCount: 1 });
    expect(JSON.stringify(inspection)).not.toContain("private-");
    const correction = publicOperationResult({ ...plan, action: "correct" }, { ...value, status: "corrected", replacementId: revision, replacementUrls: urls });
    expect(correction).toMatchObject({ status: "corrected", replacementId: revision, replacementUrls: urls });
    expect(JSON.stringify(correction)).not.toContain("private-");
  });
  it("requires a separately protected main-branch environment without changing the existing release environment", () => {
    const environment = { name: "EventCardProduction", deployment_branch_policy: { protected_branches: false, custom_branch_policies: true } };
    const policies = { total_count: 1, branch_policies: [{ name: "main", type: "branch" }] };
    expect(() => assertEnvironmentPolicy(environment, policies)).not.toThrow();
    for (const bad of [null, { ...environment, name: "Production" }, { ...environment, deployment_branch_policy: null }]) {
      expect(() => assertEnvironmentPolicy(bad, policies)).toThrow();
    }
    for (const bad of [{ total_count: 0, branch_policies: [] }, { total_count: 2, branch_policies: [...policies.branch_policies, { name: "dev", type: "branch" }] },
      { total_count: 1, branch_policies: [{ name: "main", type: "tag" }] }]) expect(() => assertEnvironmentPolicy(environment, bad)).toThrow();
  });
  it("keeps read-only uncertain-publication recovery and emergency suspension available while publishing is disabled", () => {
    const f = fixture("inspect"); delete f.env.EVENT_CARD_PUBLICATION_ENABLED; delete f.env.EVENT_CARD_DELIVERY_PROOF_SHA256;
    delete f.env.EVENT_CARD_PREVIEW_ENCRYPTION_KEY; delete f.env.R2_BUCKET;
    f.event.inputs.confirm = "READ-ONLY";
    expect(productionOperation(f.env, f.event)).toMatchObject({ action: "inspect", revision });
    // A later deployed main does not require the old preview or its key.
    expect(productionOperation({ ...f.env, GITHUB_SHA: "a".repeat(40) }, f.event).revision).toBe(revision);
    f.event.inputs.operation = "suspend"; f.event.inputs.confirm = "APPROVE-FES2-CARD";
    f.event.inputs.request = JSON.stringify({ eventId: "109", mode: "prediction", revision, expectedVersion: 0, operationId: revision });
    f.env.EVENT_CARD_PRIVATE_REASON = "Private emergency reason";
    expect(productionOperation(f.env, f.event)).toMatchObject({ action: "suspend", expectedVersion: 0 });
    // Delivery configuration is checked after the safe notice, then reports
    // partial rather than preventing removal of incorrect wrapper content.
    f.event.inputs.operation = "publish"; f.event.inputs.request = JSON.stringify({ eventId: "109", mode: "prediction", revision });
    expect(() => productionOperation(f.env, f.event)).toThrow();
  });
  it("accepts actual Vercel Production metadata despite its false production flag and rejects unverified deployments/artifacts", () => {
    const sha = "a".repeat(40);
    const deployment = { sha, environment: "Production", production_environment: false, creator: { login: "vercel[bot]" } };
    const status = { state: "success", creator: { login: "vercel[bot]" }, environment_url: "https://opensetlist-example-opensetlist-projects.vercel.app" };
    expect(assertProductionDeployment(sha, deployment, status)).toBe(status.environment_url);
    for (const bad of [{ ...deployment, sha: "b".repeat(40) }, { ...deployment, environment: "Preview" }, { ...deployment, creator: { login: "someone" } }]) {
      expect(() => assertProductionDeployment(sha, bad, status)).toThrow();
    }
    expect(() => assertProductionDeployment(sha, deployment, { ...status, state: "pending" })).toThrow();
    expect(() => assertProductionDeployment(sha, deployment, { ...status, environment_url: "https://untrusted.invalid" })).toThrow();
    const run = { head_sha: sha, head_branch: "main", event: "workflow_dispatch", conclusion: "success", run_attempt: 1, path: ".github/workflows/event-card-ops.yml",
      repository: { full_name: "opensetlist-db/opensetlist" }, actor: { login: "helloopensetlistdb" }, triggering_actor: { login: "helloopensetlistdb" } };
    expect(() => assertPreviewRun(sha, run, 1)).not.toThrow();
    expect(() => assertPreviewRun(sha, run, 2)).toThrow();
    for (const bad of [{ ...run, head_sha: "b".repeat(40) }, { ...run, conclusion: "failure" }, { ...run, path: "another.yml" }, { ...run, event: "pull_request" }]) {
      expect(() => assertPreviewRun(sha, bad, 1)).toThrow();
    }
  });
  it("refuses real local CLI processes without reading local env or attempting a production operation", () => {
    for (const action of ["verify", "execute", "invalid"]) {
      const run = spawnSync(process.execPath, ["scripts/event-og-production.mjs", action], { cwd: process.cwd(), encoding: "utf8", timeout: 10000,
        env: { ...process.env, GITHUB_ACTIONS: "false", GITHUB_EVENT_PATH: "does-not-exist-private-event.json" } });
      expect(run.status).toBe(1); expect(run.stdout).toBe("");
      expect(JSON.parse(run.stderr.trim().split("\n").at(-1)!)).toMatchObject({ status: "failed" });
      expect(run.stderr).not.toContain("does-not-exist-private-event.json");
    }
  });
  it("returns one explicit approved mode and revision, with an exact bounded target inventory", () => {
    const f = fixture(); expect(productionOperation(f.env, f.event)).toMatchObject({ action: "publish", eventIds: ["109"], mode: "prediction", revision,
      previewRunId: "123", previewRunAttempt: 1, manifestSha256: "f".repeat(64) });
    expect(productionOperation(f.env, { ...f.event, ref: "refs/heads/main" }).action).toBe("publish");
    expect(() => productionOperation(f.env, { ...f.event, ref: "refs/heads/dev" })).toThrow();
    for (const mode of ["live", "setlist"]) { f.event.inputs.request = JSON.stringify({ eventId: "110", mode, revision }); expect(productionOperation(f.env, f.event).mode).toBe(mode); }
  });
  it("requires hosted main, original and rerun owner identity, known workflow, explicit delivery signoff and production destinations", () => {
    const f = fixture(); expect(productionOperation(f.env, f.event).action).toBe("publish");
    for (const [key, value] of Object.entries({ GITHUB_ACTIONS: undefined, RUNNER_ENVIRONMENT: "self-hosted", GITHUB_REF: "refs/heads/dev",
      GITHUB_ACTOR: "someone", GITHUB_TRIGGERING_ACTOR: "someone", GITHUB_EVENT_NAME: "pull_request", GITHUB_WORKFLOW_REF: "other.yml",
      EVENT_CARD_PUBLICATION_ENABLED: "true", EVENT_CARD_DELIVERY_PROOF_SHA256: "", R2_KEY_PREFIX: "test", R2_BUCKET: "opensetlist-images-dev",
      R2_PUBLIC_BASE_URL: "https://untrusted.invalid", DATABASE_URL: f.env.DATABASE_URL!.replace(":5432", ":6543"), EVENT_CARD_PROD_PROJECT_REF: "nddawybyuedsrshhxikx" })) {
      expect(() => productionOperation({ ...f.env, [key]: value }, f.event), key).toThrow();
    }
    expect(() => productionOperation({ ...f.env, DATABASE_URL: `${f.env.DATABASE_URL}?host=untrusted.invalid` }, f.event)).toThrow();
  });
  it("rejects expanded targets, implicit modes, arbitrary keys/URLs, conflicting payloads and unbound approval hashes", () => {
    const f = fixture(); expect(productionOperation(f.env, f.event).revision).toBe(revision);
    for (const request of [{ eventId: "999", mode: "prediction", revision }, { eventId: "109", revision }, { eventId: "109", mode: "auto", revision },
      { eventId: "109", mode: "prediction", revision, key: "prod/arbitrary.png" }, { eventId: "109", mode: "prediction", revision, url: "https://untrusted.invalid" }]) {
      expect(() => productionOperation(f.env, { ...f.event, inputs: { ...f.event.inputs, request: JSON.stringify(request) } })).toThrow();
    }
    for (const changed of [{ confirm: "yes" }, { preview_run_id: "" }, { preview_run_attempt: "" }, { preview_run_attempt: "0" }, { approved_manifest_sha256: "yes" }]) {
      expect(() => productionOperation(f.env, { ...f.event, inputs: { ...f.event.inputs, ...changed } })).toThrow();
    }
  });
  it("keeps preview/list read-only and requires private server configuration for correction/suspension reasons", () => {
    const writable = fixture(); expect(productionOperation(writable.env, writable.event).mode).toBe("prediction");
    const f = fixture("preview"); f.event.inputs.request = JSON.stringify({ eventIds: ["109", "110"] }); f.event.inputs.confirm = "READ-ONLY";
    delete f.env.EVENT_CARD_PUBLICATION_ENABLED; delete f.env.R2_BUCKET;
    expect(productionOperation(f.env, f.event)).toMatchObject({ action: "preview", eventIds: ["109", "110"] });
    expect(productionOperation(f.env, f.event).mode).toBeUndefined();
    const s = fixture("suspend"); s.event.inputs.request = JSON.stringify({ eventId: "109", mode: "prediction", revision, operationId: revision, expectedVersion: 0 });
    expect(() => productionOperation(s.env, s.event)).toThrow(); s.env.EVENT_CARD_PRIVATE_REASON = "Private operator reason";
    expect(productionOperation(s.env, s.event)).toMatchObject({ action: "suspend", expectedVersion: 0 });
    expect(JSON.stringify(productionOperation(s.env, s.event))).not.toContain("Private operator reason");
  });
});
