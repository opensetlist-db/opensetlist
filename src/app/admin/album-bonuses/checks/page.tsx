import Link from "next/link";
import { notFound } from "next/navigation";
import { verifyAdmin } from "@/lib/admin-auth";
import { getBonusCheckQueue } from "@/lib/bonusChecks";
import { linkCheckState } from "@/lib/bonusLinkChecks";
import { prisma } from "@/lib/prisma";
import { formatDate, isSafeExternalUrl } from "@/lib/utils";
import LinkCheckForm from "./LinkCheckForm";

const actionLabels = {
  end: "종료 확인", restore: "복구", maintained: "유지", review_needed: "확인 필요", access_failed: "접근 실패",
};

function instant(date: Date | null) {
  return date ? formatDate(date, "ko", {
    year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "2-digit", timeZone: "Asia/Tokyo",
  }) : "—";
}

function ExternalLink({ url, children }: { url: string | null; children: React.ReactNode }) {
  return isSafeExternalUrl(url) && (
    <a href={url} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">{children}</a>
  );
}

function BonusRows({ entries }: { entries: Awaited<ReturnType<typeof getBonusCheckQueue>>["current"] }) {
  return (
    <ul className="space-y-2">
      {entries.map((bonus) => {
        const { listing, latestObservation } = bonus;
        return (
          <li key={bonus.id} className="space-y-1 break-words rounded border border-zinc-200 bg-white p-3 text-sm">
            <p className="font-semibold">{listing.album.originalTitle} · {listing.originalStoreName} · {listing.originalEditionLabel ?? "에디션 미등록"}</p>
            <p>구매 선택지 {listing.optionKey || "기본 식별자"}{listing.selectionGuide && ` · ${listing.selectionGuide}`}</p>
            <p>{bonus.originalBonusType}{bonus.originalBonusDescription && ` · ${bonus.originalBonusDescription}`}</p>
            {listing.includesPerformanceVideo === null && <p>공연 영상 포함 여부 미확인</p>}
            <p>상품 판매 기간 {instant(listing.startsAt)} ~ {instant(listing.endsAt)}</p>
            <p>특전 기간 {instant(bonus.startsAt)} ~ {instant(bonus.endsAt)}{bonus.endedAt && ` · 수동 종료 ${instant(bonus.endedAt)}`}</p>
            {listing.status === "ended" && <p>구매 옵션 종료</p>}
            <p>마지막 성공 확인 {instant(bonus.lastVerifiedAt)}</p>
            <p>{latestObservation
              ? `최근 관찰 ${actionLabels[latestObservation.action]} · ${instant(latestObservation.observedAt)} · ${latestObservation.summary}`
              : "최근 관찰 없음"}</p>
            <div className="flex flex-wrap gap-3">
              <ExternalLink url={listing.productUrl}>판매점 상품 주소</ExternalLink>
              <ExternalLink url={listing.sourceUrl}>구매 옵션 출처</ExternalLink>
              <ExternalLink url={bonus.sourceUrl}>특전 출처</ExternalLink>
              <ExternalLink url={latestObservation?.evidenceUrl ?? null}>최근 관찰 근거</ExternalLink>
              <Link href={`/admin/album-bonuses/checks/${encodeURIComponent(bonus.id)}?listingId=${encodeURIComponent(listing.id)}`}
                className="text-blue-600 underline">점검·종료·복구 이력 열기</Link>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

async function getLinkChecks(albumId?: bigint) {
  const rows = await prisma.albumStoreLinkAttempt.findMany({
    where: { albumId },
    orderBy: [{ albumId: "asc" }, { storeKey: "asc" }, { phase: "asc" }],
    include: { album: { select: { originalTitle: true } } },
  });
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = JSON.stringify([String(row.albumId), row.storeKey]);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return [...groups.values()].map((rows) => linkCheckState(rows));
}

function LinkRows({ entries }: { entries: Awaited<ReturnType<typeof getLinkChecks>> }) {
  return (
    <ul className="space-y-2">
      {entries.map(({ attempts, status, revision }) => {
        const target = attempts[0];
        const key = `${target.albumId}:${target.storeKey}`;
        return (
          <li key={key} className="space-y-2 break-words rounded border border-zinc-200 bg-white p-3 text-sm">
            <p className="font-semibold">{target.album.originalTitle} · {target.storeName} ({target.storeKey})</p>
            <ul className="space-y-1">
              {attempts.map((attempt) => (
                <li key={attempt.phase}>
                  {attempt.phase === "initial" ? "최초 시도" : attempt.phase === "retry" ? "다음 점검 재시도" : "운영자 확인"}
                  {" · "}{attempt.productUrl ? "상품 주소 확인" : "상품 주소 미확보"}
                  {" · "}{instant(attempt.observedAt)} · {attempt.summary}
                  <div className="flex flex-wrap gap-3">
                    <ExternalLink url={attempt.evidenceUrl}>시도 근거</ExternalLink>
                    <ExternalLink url={attempt.productUrl}>확인한 상품 주소</ExternalLink>
                  </div>
                </li>
              ))}
            </ul>
            {status === "found" && (
              <Link href={`/admin/albums/${target.albumId}/listings`} className="text-blue-600 underline">구매 옵션 관리</Link>
            )}
            <LinkCheckForm key={`${key}:${revision}`} albumId={String(target.albumId)}
              storeKey={target.storeKey} storeName={target.storeName} revision={revision}
              phase={status === "retry_due" ? "retry" : status === "review_needed" ? "resolve" : undefined} />
          </li>
        );
      })}
    </ul>
  );
}

export default async function BonusChecksPage({ searchParams }: {
  searchParams: Promise<{ albumId?: string | string[] }>;
}) {
  await verifyAdmin();
  const { albumId: rawId } = await searchParams;
  if (rawId && (typeof rawId !== "string" || !/^[1-9]\d{0,18}$/.test(rawId) ||
      BigInt(rawId) > BigInt("9223372036854775807"))) notFound();
  const albumId = rawId ? BigInt(rawId) : undefined;
  const [queue, links, album] = await Promise.all([
    getBonusCheckQueue(albumId),
    getLinkChecks(albumId),
    albumId === undefined ? null : prisma.album.findUnique({ where: { id: albumId }, select: { originalTitle: true } }),
  ]);
  if (albumId !== undefined && !album) notFound();
  const retry = links.filter((link) => link.status === "retry_due");
  const review = links.filter((link) => link.status === "review_needed");
  const found = links.filter((link) => link.status === "found");
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">BD 특전 점검{album && ` · ${album.originalTitle}`}</h1>
      <p>시각은 일본 표준시로 표시합니다. 판매점의 안내는 관찰 근거로 기록합니다.</p>
      <form method="get" className="flex flex-wrap items-end gap-2">
        <label className="block">앨범 ID
          <input name="albumId" defaultValue={rawId ?? ""} inputMode="numeric" pattern="[1-9][0-9]*"
            className="ml-2 rounded border px-2 py-1" />
        </label>
        <button className="rounded border px-3 py-1">목록 조회</button>
        {album && <Link href="/admin/album-bonuses/checks" className="text-blue-600 underline">전체 목록</Link>}
      </form>
      <section className="space-y-2" aria-labelledby="current-checks">
        <h2 id="current-checks" className="text-lg font-semibold">현재 점검 대상</h2>
        {!queue.current.length && !retry.length && <p>현재 점검할 항목이 없습니다.</p>}
        <BonusRows entries={queue.current} />
        {!!retry.length && <h3 className="font-medium">상품 링크 다음 점검 재시도</h3>}
        <LinkRows entries={retry} />
      </section>
      <section className="space-y-2" aria-labelledby="review-checks">
        <h2 id="review-checks" className="text-lg font-semibold">확인 필요 항목</h2>
        {!queue.review.length && !review.length && <p>확인이 필요한 항목이 없습니다.</p>}
        <BonusRows entries={queue.review} />
        {!!review.length && <h3 className="font-medium">재시도 후 운영자 확인</h3>}
        <LinkRows entries={review} />
      </section>
      <section className="space-y-2" aria-labelledby="ended-checks">
        <h2 id="ended-checks" className="text-lg font-semibold">종료 이력</h2>
        {!queue.ended.length && <p>현재 종료된 특전이 없습니다.</p>}
        <BonusRows entries={queue.ended} />
      </section>
      <section className="space-y-2" aria-labelledby="link-checks">
        <h2 id="link-checks" className="text-lg font-semibold">공식 온라인 판매점 상품 링크</h2>
        <p>공식 안내에 있는 온라인 판매점마다 최초 시도를 기록하세요. 상품 주소 미확보 시 다음 점검에서 한 번 재시도합니다.</p>
        {albumId === undefined ? <p>최초 시도를 기록하려면 앨범 ID로 목록을 조회하세요.</p>
          : <LinkCheckForm key={String(albumId)} albumId={String(albumId)} revision={0} phase="initial" />}
        {!!found.length && <h3 className="font-medium">상품 주소 확보 기록</h3>}
        <LinkRows entries={found} />
      </section>
    </div>
  );
}
