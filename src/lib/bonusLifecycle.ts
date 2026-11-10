import { createHash } from "node:crypto";
import { optionalString, optionalUrl, parseInstant, parsePeriod, parseRevision, PurchaseInputError } from "@/lib/adminPurchaseFields";
import { prisma } from "@/lib/prisma";
import { projectPurchaseOptions } from "@/lib/purchaseAvailability";

export class BonusLifecycleError extends Error {
  constructor(
    readonly code: "not_found" | "conflict" | "operation_mismatch",
    message: string,
  ) {
    super(message);
  }
}

export function validOperationId(value: unknown): value is string {
  return typeof value === "string" &&
    /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/.test(value);
}

export function parseBonusOperation(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PurchaseInputError("잘못된 JSON입니다.");
  }
  const body = value as Record<string, unknown>;
  const { action, operationId } = body;
  const listingId = optionalString(body, "listingId", 128);
  const evidenceUrl = optionalUrl(body, "evidenceUrl");
  const summary = optionalString(body, "summary");
  const observedAt = parseInstant(body.observedAt, "관찰 시각");
  if (!listingId || !validOperationId(operationId) || (action !== "end" && action !== "restore")) {
    throw new PurchaseInputError("구매 옵션, 작업 ID와 처리 유형을 확인해 주세요.");
  }
  if (!evidenceUrl || !summary || !observedAt || observedAt > new Date()) {
    throw new PurchaseInputError("근거 URL, 관찰 요약과 관찰 시각을 확인해 주세요.");
  }
  const period = action === "restore" ? parsePeriod(body) : {};
  if (action === "restore" && (period.startsAt === undefined || period.endsAt === undefined)) {
    throw new PurchaseInputError("복구할 특전의 기간을 확인해 주세요.");
  }
  if (action === "end" && (body.startsAt !== undefined || body.endsAt !== undefined)) {
    throw new PurchaseInputError("종료 시에는 특전 기간을 변경할 수 없습니다.");
  }
  return {
    listingId, action: action as "end" | "restore", operationId, evidenceUrl, summary, observedAt, ...period,
    expectedRevision: parseRevision(body.expectedRevision),
    expectedListingRevision: parseRevision(body.expectedListingRevision),
  };
}

function snapshot(bonus: { endedAt: Date | null; startsAt: Date | null; endsAt: Date | null; revision: number }) {
  return {
    revision: bonus.revision,
    endedAt: bonus.endedAt?.toISOString() ?? null,
    startsAt: bonus.startsAt?.toISOString() ?? null,
    endsAt: bonus.endsAt?.toISOString() ?? null,
  };
}

const notFound = () => new BonusLifecycleError("not_found", "이 구매 옵션에서 특전을 찾을 수 없습니다.");

export async function getBonusLifecycle(id: string, listingId: string, operationId?: string) {
  const bonus = await prisma.albumStoreBonus.findUnique({
    where: { id, listingId },
    relationLoadStrategy: "join",
    include: {
      listing: { select: {
        revision: true, originalStoreName: true, originalEditionLabel: true, productUrl: true, selectionGuide: true,
        album: { select: { originalTitle: true } },
      } },
      lifecycle: { orderBy: [{ appliedAt: "desc" }, { operationId: "asc" }], omit: { requestHash: true } },
    },
  });
  if (!bonus) throw notFound();
  const history = bonus.lifecycle.map((entry) => ({
    ...entry, observedAt: entry.observedAt.toISOString(), appliedAt: entry.appliedAt.toISOString(),
  }));
  return {
    state: { id, listingId, listingRevision: bonus.listing.revision, ...snapshot(bonus) },
    target: {
      bonusType: bonus.originalBonusType,
      description: bonus.originalBonusDescription,
      store: bonus.listing.originalStoreName,
      edition: bonus.listing.originalEditionLabel,
      album: bonus.listing.album.originalTitle,
      productUrl: bonus.listing.productUrl,
      selectionGuide: bonus.listing.selectionGuide,
    },
    history,
    operation: history.find((entry) => entry.operationId === operationId) ?? null,
  };
}

export async function applyBonusOperation(id: string, input: ReturnType<typeof parseBonusOperation>) {
  const { listingId, operationId, action, evidenceUrl, summary, observedAt } = input;
  const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  return prisma.$transaction(async (tx) => {
    // Listing edits/imports and deletion take their lock before any child write.
    // Take the same order so the option revision and its period stay stable.
    const [listingLock] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "AlbumStoreListing" WHERE id = ${listingId} FOR SHARE
    `;
    if (!listingLock) throw notFound();
    const [bonusLock] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "AlbumStoreBonus" WHERE id = ${id} AND "listingId" = ${listingId} FOR NO KEY UPDATE
    `;
    if (!bonusLock) throw notFound();

    const previous = await tx.albumStoreBonusLifecycleOperation.findUnique({
      where: { bonusId_operationId: { bonusId: id, operationId } },
    });
    if (previous) {
      const { requestHash, ...operation } = previous;
      if (requestHash !== hash) {
        throw new BonusLifecycleError("operation_mismatch", "이미 다른 내용에 사용된 작업 ID입니다.");
      }
      return { status: "already_applied" as const, operation };
    }

    const bonus = await tx.albumStoreBonus.findUniqueOrThrow({
      where: { id },
      relationLoadStrategy: "join",
      include: { listing: { include: {
        album: { select: { _count: { select: { bdEvents: { where: { isDeleted: false } } } } } },
      } } },
    });
    if (bonus.revision !== input.expectedRevision || bonus.listing.revision !== input.expectedListingRevision) {
      throw new BonusLifecycleError("conflict", "구매 옵션 또는 특전이 변경되었습니다. 최신 내용을 다시 확인해 주세요.");
    }
    const latest = await tx.albumStoreBonusLifecycleOperation.findFirst({
      where: { bonusId: id },
      orderBy: { observedAt: "desc" },
      select: { observedAt: true },
    });
    if (latest && observedAt < latest.observedAt) {
      throw new BonusLifecycleError("conflict", "더 최근의 관찰이 이미 반영되었습니다.");
    }

    const now = new Date();
    const expiredDeadline = bonus.endsAt && bonus.endsAt <= now ? bonus.endsAt : null;
    if (action === "end" && bonus.endedAt !== null) {
      throw new BonusLifecycleError("conflict", "이미 종료된 특전입니다.");
    }
    if (action === "restore" && bonus.endedAt === null && !expiredDeadline) {
      throw new BonusLifecycleError("conflict", "종료된 특전만 복구할 수 있습니다.");
    }
    const next = action === "end" ? { endedAt: now } : {
      endedAt: null,
      startsAt: input.startsAt ?? null,
      endsAt: input.endsAt ?? null,
    };
    if (action === "restore" && (
      (expiredDeadline && !next.endsAt && (!next.startsAt || next.startsAt < expiredDeadline)) ||
      projectPurchaseOptions([{ ...bonus.listing, bonuses: [{ ...bonus, ...next }] }], now, {
        performanceOnly: bonus.listing.album._count.bdEvents > 0,
      }).bonusCount === 0
    )) {
      throw new PurchaseInputError("현재 유효한 구매 옵션과 갱신된 특전 기간이 필요합니다.");
    }

    const updated = await tx.albumStoreBonus.update({
      where: { id },
      data: { ...next, revision: { increment: 1 } },
    });
    const operation = await tx.albumStoreBonusLifecycleOperation.create({
      data: {
        bonusId: id, operationId, requestHash: hash, action, evidenceUrl, summary, observedAt, appliedAt: now,
        before: snapshot(bonus), after: snapshot(updated),
      },
      omit: { requestHash: true },
    });
    return { status: "applied" as const, operation };
  }, { timeout: 15000 });
}
