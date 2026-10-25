import { createHash } from "node:crypto";
import { Prisma } from "../../generated/prisma/client";
import { prisma } from "../prisma";
import { CARD_LOCALES, type CardMode } from "./content";
import { CardPublicationError, invalid, isPublicationId, publicationOrigin, sharePath } from "./contracts";

export type CorrectionDb = Pick<typeof prisma, "$transaction">;
export type CorrectionInput = {
  eventId: string; mode: CardMode; revision: string; replacementId: string;
  expectedVersion: number; operationId: string; reason: string;
};
const conflict = () => new CardPublicationError("correction_conflict", "정정 상태가 바뀌었거나 요청 식별자가 재사용됐습니다. 이력을 확인하세요.");
const invalidTarget = () => new CardPublicationError("invalid_correction", "같은 공연·모드의 이용 가능한 완전한 발행본만 순환 없이 연결할 수 있습니다.");

/** An explicit operator decision, never an event/status-triggered operation.
 * Lock the entire event/mode graph BEFORE reading it, at READ COMMITTED, so
 * concurrent A→B/B→A cannot both pass a cycle check on separate source rows.
 * Future annotation operations must use this same lock and version contract.
 * Only annotation + append-only history change; no storage capability exists. */
export async function correctPublication(input: CorrectionInput, deps: { db?: CorrectionDb; origin?: string } = {}) {
  const { eventId, mode, revision, replacementId, expectedVersion, operationId } = input;
  sharePath(eventId, mode, revision, "ja"); sharePath(eventId, mode, replacementId, "ja");
  if (revision === replacementId || !isPublicationId(operationId) || !Number.isSafeInteger(expectedVersion)
    || expectedVersion < 0 || expectedVersion >= 2147483647 || typeof input.reason !== "string"
    || !input.reason.trim() || input.reason.trim().length > 1000) throw invalid("정정 식별자·버전·운영 사유를 확인하세요.");
  const reason = input.reason.trim(); const origin = publicationOrigin(deps.origin); const db = deps.db ?? prisma;
  const fingerprint = createHash("sha256").update(JSON.stringify({ eventId, mode, revision, replacementId, expectedVersion, operationId, reason })).digest("hex");
  const urls = (id: string) => Object.fromEntries(CARD_LOCALES.map((l) => [l, origin + sharePath(eventId, mode, id, l)]));
  const replay = async (tx: Prisma.TransactionClient) => {
    const saved = await tx.eventCardCorrection.findUnique({ where: { id: operationId }, include: { publication: { include: { annotation: true } } } });
    if (!saved) return null;
    const current = saved.publication.annotation;
    if (saved.fingerprint !== fingerprint || current?.status !== "corrected" || current.version !== saved.toVersion
      || current.replacementId !== saved.replacementId) throw conflict();
    return { operationId, publicationId: revision, replacementId, version: saved.toVersion,
      urls: urls(revision), replacementUrls: urls(replacementId), status: "reconciled" as const };
  };
  let callbackFinished = false;
  try {
    return await db.$transaction(async (tx) => {
      const lock = `event-card-annotation:${eventId}:${mode}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lock}, 0))`;
      const existing = await replay(tx); if (existing) { callbackFinished = true; return existing; }
      const event = await tx.event.findFirst({ where: { id: BigInt(eventId), isDeleted: false }, select: { id: true } });
      if (!event) throw invalidTarget();
      const rows = await tx.eventCardPublication.findMany({ where: { eventId: BigInt(eventId), mode }, orderBy: { id: "asc" },
        select: { id: true, namespace: true, annotation: true, renditions: { select: { locale: true } } } });
      const byId = new Map(rows.map((row) => [row.id, row])); const source = byId.get(revision);
      if (!source?.annotation || source.annotation.status === "suspended") throw invalidTarget();
      if (source.annotation.version !== expectedVersion) throw conflict();
      const visited = new Set([revision]); let next: string | null = replacementId;
      while (next) {
        if (visited.has(next)) throw invalidTarget(); visited.add(next);
        const target = byId.get(next);
        if (!target?.annotation || target.annotation.status === "suspended" || target.namespace !== source.namespace
          || target.renditions.length !== 3 || !CARD_LOCALES.every((l) => target.renditions.some((r) => r.locale === l))) throw invalidTarget();
        if (target.annotation.status === "active") break;
        next = target.annotation.replacementId;
        if (!next) throw invalidTarget();
      }
      if (source.renditions.length !== 3 || !CARD_LOCALES.every((l) => source.renditions.some((r) => r.locale === l))) throw invalidTarget();
      const changed = await tx.eventCardAnnotation.updateMany({ where: { publicationId: revision, version: expectedVersion,
        status: { in: ["active", "corrected"] } }, data: { status: "corrected", replacementId, privateReason: reason, version: { increment: 1 } } });
      if (changed.count !== 1) throw conflict();
      await tx.eventCardCorrection.create({ data: { id: operationId, publicationId: revision, replacementId,
        previousReplacementId: source.annotation.replacementId, previousStatus: source.annotation.status,
        fromVersion: expectedVersion, toVersion: expectedVersion + 1, fingerprint, privateReason: reason } });
      callbackFinished = true;
      return { operationId, publicationId: revision, replacementId, version: expectedVersion + 1,
        urls: urls(revision), replacementUrls: urls(replacementId), status: "corrected" as const };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 5000, timeout: 30000 });
  } catch (error) {
    // One consistent read distinguishes a committed decision from its newer
    // successor. Never resurrect a stale correction after COMMIT reply loss.
    try {
      const saved = await db.$transaction(replay, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
      if (saved) return saved;
    } catch (lookupError) {
      if (lookupError instanceof CardPublicationError) throw lookupError;
      if (callbackFinished) throw new CardPublicationError("outcome_unknown", "정정 저장 결과가 미확정입니다. 같은 작업 식별자로 재시도하세요.");
    }
    if (error instanceof CardPublicationError) throw error;
    throw new CardPublicationError(callbackFinished ? "outcome_unknown" : "not_saved",
      callbackFinished ? "정정 저장 결과가 미확정입니다. 같은 작업 식별자로 재시도하세요." : "정정을 저장하지 못했습니다. 현재 상태와 이력을 확인한 뒤 같은 식별자로 재시도하세요.");
  }
}
