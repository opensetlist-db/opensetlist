import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { serializeBigInt, formatDate } from "@/lib/utils";
import { ContestReportActions } from "@/components/admin/ContestReportActions";
import type { ContestReportStatus } from "@/generated/prisma/enums";

// 정정 요청 (ContestReport) 운영자 트리아지 페이지.
// CLAUDE.md의 admin-i18n exemption에 따라 한국어만 사용 — 운영자
// 단독 화면이라 useTranslations 스레딩 없음.
//
// 1C에서 "해결" = 운영자가 기존 admin row-edit 도구로 수동 정정.
// 자동 적용 (예: wrong_song에 대해 SetlistItemSong.songId 교체)은
// Phase 2 polish에서 추가됨.

const TABS: { key: ContestReportStatus; label: string }[] = [
  { key: "pending", label: "대기" },
  { key: "resolved", label: "해결됨" },
  { key: "dismissed", label: "기각" },
];

const TYPE_LABELS: Record<string, string> = {
  wrong_song: "곡이 잘못됨",
  missing_performer: "출연자가 빠짐",
  wrong_variant: "버전이 잘못됨",
  other: "기타",
};

const ROW_LIMIT = 200;

function resolveStatus(value: string | undefined): ContestReportStatus {
  if (value === "resolved" || value === "dismissed") return value;
  return "pending";
}

type SearchParams = Promise<{ status?: string }>;

interface PayloadShape {
  proposedSongId?: number;
  proposedVariantId?: number;
  stageIdentityIds?: string[];
}

function summarizePayload(type: string, payload: unknown): string {
  // 운영자가 한눈에 볼 수 있는 요약 문자열. 클릭하면 detail 페이지가
  // 풀 paylod를 보여주지만 1C에서는 detail 페이지 없이 inline 표시.
  if (payload === null || typeof payload !== "object") return "—";
  const p = payload as PayloadShape;
  if (type === "wrong_song") {
    return `→ Song #${p.proposedSongId ?? "?"}`;
  }
  if (type === "wrong_variant") {
    if (p.proposedVariantId !== undefined) {
      return `→ Song #${p.proposedSongId} (variant #${p.proposedVariantId})`;
    }
    return `→ Song #${p.proposedSongId ?? "?"} (base, variant TBD)`;
  }
  if (type === "missing_performer") {
    const count = Array.isArray(p.stageIdentityIds)
      ? p.stageIdentityIds.length
      : 0;
    return `${count}명 누락`;
  }
  return "—";
}

export default async function ContestReportsAdminPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const status = resolveStatus(sp.status);

  const reportsRaw = await prisma.contestReport.findMany({
    where: { status },
    orderBy: { createdAt: "desc" },
    take: ROW_LIMIT,
    include: {
      setlistItem: {
        select: {
          id: true,
          position: true,
          eventId: true,
          event: {
            select: { id: true, originalName: true },
          },
          songs: {
            select: { song: { select: { id: true, originalTitle: true } } },
          },
        },
      },
    },
  });
  // `serializeBigInt` strips Prisma's typed includes (it goes
  // through `JSON.parse`); cast back to the include-aware shape so
  // the table renderer below stays type-safe. Per-row payload
  // typing happens in `summarizePayload`.
  type SerializedReport = (typeof reportsRaw)[number] & {
    payload: unknown;
  };
  const reports = serializeBigInt(reportsRaw) as unknown as SerializedReport[];

  return (
    <div className="max-w-6xl">
      <div className="mb-4 flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">정정 요청</h1>
        <div className="text-sm text-zinc-500">
          {reports.length}건 (최대 {ROW_LIMIT}건 표시)
        </div>
      </div>

      <div className="mb-4 flex gap-2 border-b border-zinc-200">
        {TABS.map((tab) => (
          <Link
            key={tab.key}
            href={`/admin/contest-reports?status=${tab.key}`}
            className={
              tab.key === status
                ? "border-b-2 border-zinc-900 px-3 py-2 text-sm font-medium"
                : "border-b-2 border-transparent px-3 py-2 text-sm text-zinc-500 hover:text-zinc-900"
            }
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {reports.length === 0 ? (
        <p className="text-sm text-zinc-500">표시할 정정 요청이 없습니다.</p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wider text-zinc-500">
              <th className="py-2 pr-3">이벤트</th>
              <th className="py-2 pr-3">위치</th>
              <th className="py-2 pr-3">현재 곡</th>
              <th className="py-2 pr-3">유형</th>
              <th className="py-2 pr-3">요약</th>
              <th className="py-2 pr-3">코멘트</th>
              <th className="py-2 pr-3">접수</th>
              {status === "pending" && (
                <th className="py-2 pr-3 text-right">조치</th>
              )}
            </tr>
          </thead>
          <tbody>
            {reports.map((r) => {
              const eventTitle =
                r.setlistItem.event?.originalName ?? `Event #${r.setlistItem.eventId}`;
              const currentSongTitle =
                r.setlistItem.songs?.[0]?.song?.originalTitle ?? "—";
              return (
                <tr
                  key={r.id}
                  className="border-b border-zinc-100 align-top"
                >
                  <td className="py-2 pr-3">
                    <Link
                      href={`/admin/events/${r.setlistItem.eventId}/edit`}
                      className="text-zinc-900 hover:underline"
                    >
                      {eventTitle}
                    </Link>
                  </td>
                  <td className="py-2 pr-3 text-zinc-700">
                    #{r.setlistItem.position}
                  </td>
                  <td className="py-2 pr-3 text-zinc-700">
                    {currentSongTitle}
                  </td>
                  <td className="py-2 pr-3 text-zinc-700">
                    {TYPE_LABELS[r.type] ?? r.type}
                  </td>
                  <td className="py-2 pr-3 text-zinc-600">
                    {summarizePayload(r.type, r.payload)}
                  </td>
                  <td className="py-2 pr-3 max-w-xs text-zinc-600">
                    {r.comment ? (
                      <span className="line-clamp-2">{r.comment}</span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="py-2 pr-3 text-xs text-zinc-500">
                    {formatDate(r.createdAt, "ko")}
                  </td>
                  {status === "pending" && (
                    <td className="py-2 pr-3 text-right">
                      <ContestReportActions reportId={r.id} />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
