import { CARD_MODES, CARD_LOCALES, type CardMode, type CardLocale } from "./content";
import { isPublicationId } from "./contracts";

type Target = { id: string; slug: string };
type DisplayTitle = { eventId: string; locale: CardLocale; title: string };
export type ProductionOperation = {
  action: "preview" | "publish" | "list" | "inspect" | "correct" | "suspend";
  eventIds: string[]; targets: Target[]; mode?: CardMode; revision?: string;
  replacementId?: string; operationId?: string; expectedVersion?: number;
  displayTitles: DisplayTitle[]; previewRunId?: string; previewRunAttempt?: number; manifestSha256?: string;
};
function fail(): never { throw new Error("운영 카드 작업의 실행 환경·대상·명시적 승인을 확인하세요."); }
const id = (v: unknown): v is string => typeof v === "string" && /^[1-9]\d*$/.test(v) && BigInt(v) <= BigInt("9223372036854775807");
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);

/** The local dev CLI remains dev-only. A separate, owner-dispatched hosted
 * operation is the production boundary; environment names alone are not an
 * approval gate. The dedicated environment must restrict deployments to main. */
export function productionOperation(env: Record<string, string | undefined>, event: unknown): ProductionOperation {
  if (env.GITHUB_ACTIONS !== "true" || env.RUNNER_ENVIRONMENT !== "github-hosted" || env.GITHUB_EVENT_NAME !== "workflow_dispatch"
    || env.GITHUB_REPOSITORY !== "opensetlist-db/opensetlist" || env.GITHUB_REF !== "refs/heads/main"
    || env.GITHUB_ACTOR !== "helloopensetlistdb" || env.GITHUB_TRIGGERING_ACTOR !== "helloopensetlistdb"
    || env.GITHUB_WORKFLOW_REF !== "opensetlist-db/opensetlist/.github/workflows/event-card-ops.yml@refs/heads/main"
    || !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? "")) fail();
  if (!object(event) || !["main", "refs/heads/main"].includes(String(event.ref)) || !object(event.sender) || event.sender.login !== "helloopensetlistdb"
    || !object(event.repository) || event.repository.full_name !== env.GITHUB_REPOSITORY || !object(event.inputs)) fail();
  const inputs = event.inputs;
  if (!["preview", "publish", "list", "inspect", "correct", "suspend"].includes(String(inputs.operation))) fail();
  const action = inputs.operation as ProductionOperation["action"];
  let request: unknown; let rawTargets: unknown;
  try { request = JSON.parse(String(inputs.request)); rawTargets = JSON.parse(env.EVENT_CARD_FES2_TARGETS ?? "null"); } catch { fail(); }
  if (!object(request) || !Array.isArray(rawTargets) || rawTargets.length !== 2
    || rawTargets.some((t) => !object(t) || Object.keys(t).sort().join() !== "id,slug" || !id(t.id) || typeof t.slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(t.slug))) fail();
  const targets = rawTargets as Target[];
  if (new Set(targets.map((t) => t.id)).size !== 2 || new Set(targets.map((t) => t.slug)).size !== 2) fail();
  const allowed = action === "preview" ? ["eventIds", "displayTitles"] : action === "list" ? ["eventId"]
    : ["publish", "inspect"].includes(action) ? ["eventId", "mode", "revision"]
    : action === "correct" ? ["eventId", "mode", "revision", "replacementId", "expectedVersion", "operationId"]
    : ["eventId", "mode", "revision", "expectedVersion", "operationId"];
  if (Object.keys(request).some((k) => !allowed.includes(k))) fail();
  const eventIds = action === "preview" ? request.eventIds : [request.eventId];
  if (!Array.isArray(eventIds) || !eventIds.length || eventIds.length > 2 || new Set(eventIds).size !== eventIds.length
    || eventIds.some((v) => !id(v) || !targets.some((t) => t.id === v))) fail();
  const result: ProductionOperation = { action, eventIds, targets, displayTitles: [] };
  if (action === "preview") {
    if (inputs.confirm !== "READ-ONLY") fail();
    const titles = request.displayTitles ?? [];
    if (!Array.isArray(titles) || titles.length > 6 || titles.some((t) => !object(t)
      || Object.keys(t).sort().join() !== "eventId,locale,title" || !eventIds.includes(t.eventId)
      || !CARD_LOCALES.includes(t.locale as CardLocale) || typeof t.title !== "string" || !t.title.trim())) fail();
    result.displayTitles = titles as DisplayTitle[];
    if (new Set(result.displayTitles.map((t) => `${t.eventId}/${t.locale}`)).size !== titles.length) fail();
  } else if (action === "list") {
    if (inputs.confirm !== "READ-ONLY") fail();
  } else {
    if (!CARD_MODES.includes(request.mode as CardMode) || typeof request.revision !== "string" || !isPublicationId(request.revision)
      || inputs.confirm !== (action === "inspect" ? "READ-ONLY" : "APPROVE-FES2-CARD")) fail();
    result.mode = request.mode as CardMode; result.revision = request.revision;
    if (action === "publish") {
      if (env.EVENT_CARD_PUBLICATION_ENABLED !== "reviewed-delivery-paths" || !hash(env.EVENT_CARD_DELIVERY_PROOF_SHA256)) fail();
      if (!id(inputs.preview_run_id) || !id(inputs.preview_run_attempt) || !Number.isSafeInteger(Number(inputs.preview_run_attempt)) || !hash(inputs.approved_manifest_sha256)) fail();
      result.previewRunId = inputs.preview_run_id; result.previewRunAttempt = Number(inputs.preview_run_attempt); result.manifestSha256 = inputs.approved_manifest_sha256;
    } else if (action !== "inspect") {
      if (!Number.isInteger(request.expectedVersion) || Number(request.expectedVersion) < 0 || Number(request.expectedVersion) >= 2147483647
        || typeof request.operationId !== "string" || !isPublicationId(request.operationId)
        || !env.EVENT_CARD_PRIVATE_REASON?.trim()) fail();
      result.expectedVersion = Number(request.expectedVersion); result.operationId = request.operationId;
      if (action === "correct") {
        if (typeof request.replacementId !== "string" || !isPublicationId(request.replacementId)) fail();
        result.replacementId = request.replacementId;
      }
    }
  }
  const project = env.EVENT_CARD_PROD_PROJECT_REF;
  if (!project || !/^[a-z]{20}$/.test(project) || project === "nddawybyuedsrshhxikx") fail();
  for (const name of ["DATABASE_URL", "DATABASE_URL_UNPOOLED"]) {
    let url: URL; try { url = new URL(env[name] ?? ""); } catch { fail(); }
    if (!["postgresql:", "postgres:"].includes(url.protocol) || !["", "5432"].includes(url.port) || url.pathname !== "/postgres" || url.hash
      || [...url.searchParams.keys()].some((key) => !["sslmode", "ssl", "schema", "pgbouncer", "connection_limit", "pool_timeout"].includes(key))
      || !(url.hostname === `db.${project}.supabase.co` || (url.hostname.endsWith(".pooler.supabase.com") && decodeURIComponent(url.username) === `postgres.${project}`))) fail();
  }
  if (["preview", "publish"].includes(action) && !hash(env.EVENT_CARD_PREVIEW_ENCRYPTION_KEY)) fail();
  if (action === "publish") assertProductionStorage(env);
  return result;
}

/** Call lazily for suspension, after the safe notice commits. Missing delivery
 * credentials must not prevent removing incorrect content from the wrapper. */
export function assertProductionStorage(env: Record<string, string | undefined>) {
  if (env.R2_KEY_PREFIX !== "prod" || !env.EVENT_CARD_PROD_BUCKET
    || env.EVENT_CARD_PROD_BUCKET === "opensetlist-images-dev" || env.R2_BUCKET !== env.EVENT_CARD_PROD_BUCKET
    || env.R2_PUBLIC_BASE_URL !== "https://img.opensetlist.com") fail();
}

export function assertEnvironmentPolicy(environment: unknown, policies: unknown) {
  if (!object(environment) || environment.name !== "EventCardProduction" || !object(environment.deployment_branch_policy)
    || environment.deployment_branch_policy.protected_branches !== false || environment.deployment_branch_policy.custom_branch_policies !== true
    || !object(policies) || policies.total_count !== 1 || !Array.isArray(policies.branch_policies) || policies.branch_policies.length !== 1) fail();
  const policy = policies.branch_policies[0];
  if (!object(policy) || policy.name !== "main" || policy.type !== "branch") fail();
}

/** GitHub's Vercel integration names the environment Production but reports
 * production_environment:false. Verify its actual provider, SHA and successful
 * status rather than trusting that boolean or an arbitrary input URL. */
export function assertProductionDeployment(sha: string, deployment: unknown, status: unknown) {
  if (!object(deployment) || deployment.sha !== sha || deployment.environment !== "Production"
    || !object(deployment.creator) || deployment.creator.login !== "vercel[bot]" || !object(status)
    || status.state !== "success" || !object(status.creator) || status.creator.login !== "vercel[bot]"
    || typeof status.environment_url !== "string") fail();
  const url = new URL(status.environment_url);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/"
    || !/^opensetlist-[a-z0-9]+-opensetlist-projects\.vercel\.app$/.test(url.hostname)) fail();
  return url.origin;
}

export function assertPreviewRun(sha: string, run: unknown, attempt: number) {
  if (!object(run) || run.head_sha !== sha || run.head_branch !== "main" || run.event !== "workflow_dispatch"
    || run.conclusion !== "success" || run.path !== ".github/workflows/event-card-ops.yml" || run.run_attempt !== attempt
    || !object(run.repository) || run.repository.full_name !== "opensetlist-db/opensetlist"
    || !object(run.actor) || run.actor.login !== "helloopensetlistdb"
    || !object(run.triggering_actor) || run.triggering_actor.login !== "helloopensetlistdb") fail();
}

/** Public repository artifacts are a separate contract from the operator's
 * private service result. Full delivery/writer/audit details remain in the DB. */
export function publicOperationResult(plan: Pick<ProductionOperation, "action" | "eventIds" | "mode" | "revision">, value: unknown) {
  if (!object(value)) fail();
  const fields = (source: Record<string, unknown>, names: string[]) => Object.fromEntries(names
    .filter((name) => ["string", "number", "boolean"].includes(typeof source[name]))
    .map((name) => [name, source[name]]));
  const urls = (value: unknown) => object(value) ? Object.fromEntries(CARD_LOCALES.filter((l) => typeof value[l] === "string").map((l) => [l, value[l]])) : undefined;
  const annotation = (value: unknown) => object(value) ? fields(value, ["status", "version"]) : undefined;
  const common = { action: plan.action, eventIds: plan.eventIds, mode: plan.mode, publicationId: plan.revision };
  if (plan.action === "list") {
    if (!Array.isArray(value.publications)) fail();
    return { ...common, publications: value.publications.map((row) => {
      if (!object(row)) fail();
      return { ...fields(row, ["publicationId", "mode", "status", "version"]), urls: urls(row.urls) };
    }) };
  }
  if (plan.action === "inspect") {
    if (!Array.isArray(value.unsettledWriters)) fail();
    return { ...common, ...fields(value, ["outcome", "previewId", "approvalSha256"]),
      outputs: urls(value.outputs), annotation: annotation(value.annotation), unsettledWriterCount: value.unsettledWriters.length };
  }
  return { ...common, ...fields(value, ["status", "version", "safeNoticeApplied", "replacementId"]), urls: urls(value.urls),
    replacementUrls: urls(value.replacementUrls), publicationState: annotation(value.publicationState) };
}
