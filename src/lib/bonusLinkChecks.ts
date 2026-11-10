import { createHash } from "node:crypto";
import { optionalString, optionalUrl, parseInstant, parseRevision, PurchaseInputError } from "@/lib/adminPurchaseFields";
import { BonusLifecycleError, validOperationId } from "@/lib/bonusLifecycle";
import { prisma } from "@/lib/prisma";
import { officialStoreKey } from "@/lib/storeKeys";

export function parseLinkCheckTarget(albumId: unknown, storeKey: unknown) {
  const key = optionalString({ storeKey }, "storeKey", 100)?.normalize("NFKC").toLowerCase();
  if (typeof albumId !== "string" || !/^[1-9]\d{0,18}$/.test(albumId) ||
      BigInt(albumId) > BigInt("9223372036854775807") || !key || key.length > 100) {
    throw new PurchaseInputError("앨범과 공식 판매점을 확인해 주세요.");
  }
  return { albumId: BigInt(albumId), storeKey: key };
}

export function parseLinkCheck(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PurchaseInputError("잘못된 JSON입니다.");
  }
  const body = value as Record<string, unknown>;
  const target = parseLinkCheckTarget(body.albumId, body.storeKey);
  const { operationId, phase } = body;
  const storeName = optionalString(body, "storeName", 100);
  const evidenceUrl = optionalUrl(body, "evidenceUrl");
  const summary = optionalString(body, "summary");
  const observedAt = parseInstant(body.observedAt, "관찰 시각");
  const productUrl = optionalUrl(body, "productUrl") ?? null;
  if (!storeName || !validOperationId(operationId) ||
      (phase !== "initial" && phase !== "retry" && phase !== "resolve" &&
       phase !== "exclude" && phase !== "reinclude") ||
      !evidenceUrl || !summary || !observedAt || observedAt > new Date()) {
    throw new PurchaseInputError("판매점, 시도 유형, 근거 URL, 요약 및 관찰 시각을 확인해 주세요.");
  }
  if (officialStoreKey(storeName) !== target.storeKey) {
    throw new PurchaseInputError("공식 판매점 이름과 식별자가 일치해야 합니다.");
  }
  if (productUrl) {
    if (phase === "exclude" || phase === "reinclude") {
      throw new PurchaseInputError("점검 제외와 재포함은 근거만 기록합니다.");
    }
    const { hostname, pathname, searchParams } = new URL(productUrl);
    if (/^(?:\/+|\/(?:index\.[a-z]+|home|top)\/?)$/i.test(pathname) ||
        /\/(?:s|search|searchresults|search-results|catalogsearch)(?:[/.]|$)/i.test(pathname) ||
        searchParams.get("mode")?.toLowerCase() === "search" ||
        hostname === "amzn.to") {
      throw new PurchaseInputError("홈페이지나 검색·단축 주소 대신 확인한 판매점 상품 주소를 입력해 주세요.");
    }
  } else if (phase === "resolve") {
    throw new PurchaseInputError("확인 필요 항목을 해결하려면 확인한 상품 주소가 필요합니다.");
  }
  const input = {
    ...target, storeName, operationId, phase, evidenceUrl, summary, observedAt, productUrl,
    expectedRevision: parseRevision(body.expectedRevision),
  };
  if (phase === "exclude" || phase === "reinclude") {
    const evidenceType = body.evidenceType;
    if ((phase === "exclude" && (evidenceType === "expired" || evidenceType === "ended")) ||
        (phase === "reinclude" && evidenceType === "active")) {
      return { ...input, phase, evidenceType } as const;
    }
    throw new PurchaseInputError("점검 결정에 맞는 근거 유형을 확인해 주세요.");
  }
  return { ...input, phase } as const;
}

type Attempt = { productUrl: string | null; operationId: string };
type ReviewOperation = { phase: "exclude" | "reinclude"; operationId: string };

export function linkCheckState<T extends Attempt, R extends ReviewOperation>(
  attempts: T[], reviewHistory: R[], operationId?: string,
) {
  const status = reviewHistory.at(-1)?.phase === "exclude" ? "excluded" :
    attempts.some((attempt) => attempt.productUrl !== null) ? "found" :
    attempts.length === 0 ? "untried" : attempts.length === 1 ? "retry_due" : "review_needed";
  return {
    revision: attempts.length + reviewHistory.length, status, attempts, reviewHistory,
    operation: attempts.find((attempt) => attempt.operationId === operationId) ??
      reviewHistory.find((review) => review.operationId === operationId) ?? null,
  };
}

const notFound = () => new BonusLifecycleError("not_found", "앨범을 찾을 수 없습니다.");

export async function getLinkCheck(target: ReturnType<typeof parseLinkCheckTarget>, operationId?: string) {
  const album = await prisma.album.findUnique({
    relationLoadStrategy: "join",
    where: { id: target.albumId },
    select: {
      storeLinkAttempts: {
        where: { storeKey: target.storeKey },
        orderBy: { phase: "asc" },
        omit: { albumId: true, requestHash: true },
      },
      storeLinkReviewOperations: {
        where: { storeKey: target.storeKey },
        orderBy: { observedAt: "asc" },
        omit: { albumId: true, requestHash: true },
      },
    },
  });
  if (!album) throw notFound();
  return linkCheckState(album.storeLinkAttempts, album.storeLinkReviewOperations, operationId);
}

export async function applyLinkCheck(input: ReturnType<typeof parseLinkCheck>) {
  const { expectedRevision, ...data } = input;
  const { albumId, storeKey, phase, operationId, observedAt } = data;
  const requestHash = createHash("sha256").update(JSON.stringify({
    ...input, albumId: String(albumId),
  })).digest("hex");
  return prisma.$transaction(async (tx) => {
    // Lock the parent even on the first attempt, when there is no store row to lock.
    const [album] = await tx.$queryRaw<{ id: bigint }[]>`
      SELECT id FROM "Album" WHERE id = ${albumId} FOR NO KEY UPDATE
    `;
    if (!album) throw notFound();
    const rows = await tx.albumStoreLinkAttempt.findMany({
      where: { albumId, storeKey },
      orderBy: { phase: "asc" },
      omit: { albumId: true },
    });
    const reviews = await tx.albumStoreLinkReviewOperation.findMany({
      where: { albumId, storeKey },
      orderBy: { observedAt: "asc" },
      omit: { albumId: true },
    });
    const state = linkCheckState(rows, reviews, operationId);
    if (state.operation) {
      const { requestHash: previousHash, ...operation } = state.operation;
      if (requestHash !== previousHash) {
        throw new BonusLifecycleError("operation_mismatch", "이미 다른 내용에 사용된 작업 ID입니다.");
      }
      return { status: "already_applied" as const, operation };
    }
    const requiredStatus = { initial: "untried", retry: "retry_due", resolve: "review_needed", reinclude: "excluded" };
    const allowed = phase === "exclude"
      ? state.status === "retry_due" || state.status === "review_needed"
      : state.status === requiredStatus[phase];
    const latestAttempt = rows.at(-1);
    const latestReview = reviews.at(-1);
    if (expectedRevision !== state.revision || !allowed ||
        (latestAttempt && observedAt <= latestAttempt.observedAt) ||
        (latestReview && observedAt <= latestReview.observedAt)) {
      throw new BonusLifecycleError("conflict", "현재 상태 또는 기록 시각이 변경되었습니다. 목록을 다시 확인해 주세요.");
    }
    if (rows[0] && data.storeName !== rows[0].storeName) {
      throw new BonusLifecycleError("conflict", "최초 시도에 기록된 판매점과 일치해야 합니다.");
    }
    const operation = "evidenceType" in data
      ? await tx.albumStoreLinkReviewOperation.create({
        data: {
          albumId, storeKey, phase: data.phase, operationId, observedAt,
          evidenceType: data.evidenceType, evidenceUrl: data.evidenceUrl, summary: data.summary, requestHash,
        },
        omit: { albumId: true, requestHash: true },
      })
      : await tx.albumStoreLinkAttempt.create({
        data: { ...data, requestHash },
        omit: { albumId: true, requestHash: true },
      });
    return { status: "applied" as const, operation };
  });
}
