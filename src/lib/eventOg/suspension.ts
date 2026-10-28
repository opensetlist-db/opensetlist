import { createHash } from "node:crypto";
import { Prisma } from "../../generated/prisma/client";
import { prisma } from "../prisma";
import { CARD_LOCALES, type CardMode } from "./content";
import { CardPublicationError, INCLUDE, invalid, isPublicationId, publicationOrigin, sharePath } from "./contracts";
import { getCardDelivery, validateDeliveryTarget, deliveryErrorCode, type CardDelivery, type DeliveryReport, type DeliveryTarget } from "./delivery";

export type SuspensionInput = { eventId: string; mode: CardMode; revision: string; expectedVersion: number; operationId: string; reason: string };
export type SuspensionDb = Pick<typeof prisma, "$transaction" | "eventCardSuspensionAttempt" | "eventCardWriteAttempt">;
const conflict = () => new CardPublicationError("suspension_conflict", "공개 중단 상태가 바뀌었거나 작업 식별자가 재사용됐습니다. 저장된 이력을 확인하세요.");

/** Persist a safe notice FIRST. Only a reconciled, current suspension decision
 * may perform external revocation. Delivery work is intentionally outside the
 * transaction: partial origin/cache failures cannot roll the safe notice back. */
export async function suspendPublication(input: SuspensionInput, deps: { db?: SuspensionDb; delivery?: CardDelivery; origin?: string } = {}) {
  const { eventId, mode, revision, expectedVersion, operationId } = input;
  sharePath(eventId, mode, revision, "ja");
  if (!isPublicationId(operationId) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0 || expectedVersion >= 2147483647
    || typeof input.reason !== "string" || !input.reason.trim() || input.reason.trim().length > 1000 || input.reason.includes("\u0000")) {
    throw invalid("공개 중단 식별자·버전·운영 사유를 확인하세요.");
  }
  const reason = input.reason.trim(); const db = deps.db ?? prisma; const origin = publicationOrigin(deps.origin);
  const fingerprint = createHash("sha256").update(JSON.stringify({ action: "suspend", eventId, mode, revision, expectedVersion, operationId, reason })).digest("hex");
  const replay = async (tx: Prisma.TransactionClient) => {
    const saved = await tx.eventCardSuspension.findUnique({ where: { id: operationId }, include: { publication: { include: { annotation: true } } } });
    if (!saved) return null;
    const current = saved.publication.annotation;
    if (saved.fingerprint !== fingerprint || current?.status !== "suspended" || current.version !== saved.toVersion) throw conflict();
    return saved;
  };
  let finished = false;
  const decision = await (async () => {
    try {
      return await db.$transaction(async (tx) => {
        const lock = `event-card-annotation:${eventId}:${mode}`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lock}, 0))`;
        const existing = await replay(tx); if (existing) { finished = true; return existing; }
        const row = await tx.eventCardPublication.findFirst({ where: { id: revision, eventId: BigInt(eventId), mode }, include: INCLUDE });
        // A soft-deleted event still has owned image URLs to stop. This does
        // not make its share page visible: the public reader keeps its404.
        if (!row?.annotation || row.renditions.length !== 3 || !CARD_LOCALES.every((l) => row.renditions.some((r) => r.locale === l))) {
          throw invalid("공개 중단할 완전한 발행본을 찾을 수 없습니다.");
        }
        if (row.annotation.status === "suspended" || row.annotation.version !== expectedVersion) throw conflict();
        const target: DeliveryTarget = { eventId, mode, publicationId: revision, namespace: row.namespace,
          images: row.renditions.map((r) => ({ locale: r.locale, key: r.asset.objectKey, url: r.asset.publicUrl, sha256: r.sha256 })) };
        validateDeliveryTarget(target);
        const changed = await tx.eventCardAnnotation.updateMany({ where: { publicationId: revision, version: expectedVersion,
          status: { in: ["active", "corrected"] } }, data: { status: "suspended", privateReason: reason, version: { increment: 1 } } });
        if (changed.count !== 1) throw conflict();
        const saved = await tx.eventCardSuspension.create({ data: { id: operationId, publicationId: revision,
          previousStatus: row.annotation.status, previousReplacementId: row.annotation.replacementId, fromVersion: expectedVersion,
          toVersion: expectedVersion + 1, fingerprint, privateReason: reason, targets: target as Prisma.InputJsonValue },
          include: { publication: { include: { annotation: true } } } });
        finished = true; return saved;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 30000, timeout: 30000 });
    } catch (error) {
      try {
        const saved = await db.$transaction(replay, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
        if (saved) return saved;
      } catch (lookupError) {
        if (lookupError instanceof CardPublicationError) throw lookupError;
        if (finished) throw new CardPublicationError("outcome_unknown", "안내 적용 결과가 미확정입니다. 같은 공개 중단 작업으로 재시도하세요.");
      }
      if (error instanceof CardPublicationError) throw error;
      throw new CardPublicationError(finished ? "outcome_unknown" : "not_saved", finished
        ? "안내 적용 결과가 미확정입니다. 같은 공개 중단 작업으로 재시도하세요." : "공개 중단을 저장하지 못했습니다. 이력을 확인한 뒤 같은 작업으로 재시도하세요.");
    }
  })();
  const target = decision.targets as unknown as DeliveryTarget;
  validateDeliveryTarget(target);
  let attempt: { id: string };
  try { attempt = await db.eventCardSuspensionAttempt.create({ data: { suspensionId: operationId }, select: { id: true } }); }
  catch { throw new CardPublicationError("outcome_unknown", "안내는 적용됐지만 전달 경로 중단 시도 이력을 저장하지 못했습니다. 같은 작업으로 재시도하세요."); }
  let delivery: DeliveryReport;
  try { delivery = await (deps.delivery ?? getCardDelivery()).revoke(target); }
  catch (error) {
    delivery = { origins: target.images.map((i) => ({ key: i.key, status: "failed", code: deliveryErrorCode(error) })),
      cache: { status: "failed", prefixes: [], code: "not_attempted" }, public: [] };
  }
  try {
    const writers = await db.eventCardWriteAttempt.findMany({ where: { publicationId: revision, settledAt: null },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true } });
    const complete = delivery.origins.length === 3 && target.images.every((i) => delivery.origins.some((r) => r.key === i.key && r.status === "blocked"))
      && delivery.cache.status !== "failed" && delivery.public.length >= 3 && delivery.public.every((r) => r.blocked) && writers.length === 0;
    const report = { complete, ...delivery, unsettledWriters: writers.map((w) => w.id) };
    const stored = await db.eventCardSuspensionAttempt.updateMany({ where: { id: attempt.id, completedAt: null },
      data: { completedAt: new Date(), report: report as Prisma.InputJsonValue } });
    if (stored.count !== 1) throw new Error("Delivery attempt changed");
    return { status: complete ? "suspended" as const : "partial" as const, safeNoticeApplied: true, operationId, publicationId: revision,
      version: decision.toVersion, attemptId: attempt.id, urls: Object.fromEntries(CARD_LOCALES.map((l) => [l, origin + sharePath(eventId, mode, revision, l)])), report };
  } catch {
    // A DELETE/purge may already have happened. The unfinished audit attempt
    // survives, and the SAME operation can verify/revoke again without PUTs.
    throw new CardPublicationError("outcome_unknown", "안내는 적용됐지만 이미지 차단 결과 이력이 미확정입니다. 같은 작업으로 재시도하세요.");
  }
}
