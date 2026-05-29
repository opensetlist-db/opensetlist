import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import type { AlbumBonusImportJobStatus } from "@/generated/prisma/enums";
import CreateJobClient from "./CreateJobClient";

type Props = {
  searchParams: Promise<{ status?: string }>;
};

const STATUS_TABS: { value: AlbumBonusImportJobStatus; label: string }[] = [
  { value: "pending", label: "검토 대기" },
  { value: "applied", label: "적용됨" },
  { value: "discarded", label: "버려짐" },
];

function parseStatus(raw: string | undefined): AlbumBonusImportJobStatus {
  if (raw === "applied" || raw === "discarded") return raw;
  return "pending";
}

export default async function ImportReviewListPage({ searchParams }: Props) {
  const params = await searchParams;
  const status = parseStatus(params.status);

  const jobs = await prisma.albumBonusImportJob.findMany({
    where: { status },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      albumId: true,
      sourceUrl: true,
      status: true,
      notes: true,
      createdAt: true,
      appliedAt: true,
      discardedAt: true,
      candidates: true,
      album: {
        select: {
          id: true,
          originalTitle: true,
          slug: true,
        },
      },
    },
  });

  // Per-row listing count for the list view — cheap to derive from the
  // candidates JSON we already loaded (vs. another query). The cast is
  // safe: the column is constrained to ParsedCandidates by the POST
  // validator.
  type CandidatesShape = { listings?: unknown[] };

  const rows = serializeBigInt(jobs).map((j) => ({
    ...j,
    listingCount: Array.isArray((j.candidates as CandidatesShape).listings)
      ? ((j.candidates as CandidatesShape).listings as unknown[]).length
      : 0,
  }));

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-2xl font-bold">특전 임포트 검토</h1>
        <p className="text-sm text-zinc-500">
          公式 뉴스 페이지 스크레이프 후보를 검토하고 적용합니다.
        </p>
      </div>

      <div className="mb-4 flex gap-3 border-b border-zinc-200 text-sm">
        {STATUS_TABS.map((tab) => {
          const isActive = tab.value === status;
          const href =
            tab.value === "pending"
              ? "/admin/album-bonuses/import-review"
              : `/admin/album-bonuses/import-review?status=${tab.value}`;
          return (
            <Link
              key={tab.value}
              href={href}
              className={
                isActive
                  ? "border-b-2 border-zinc-900 pb-2 font-semibold"
                  : "pb-2 text-zinc-500 hover:text-zinc-700"
              }
            >
              {tab.label}
            </Link>
          );
        })}
      </div>

      {status === "pending" && (
        <div className="mb-6 rounded border border-zinc-200 bg-zinc-50 p-4">
          <h2 className="mb-2 text-base font-semibold">새 임포트 작업 생성</h2>
          <p className="mb-2 text-xs text-zinc-500">
            <code>wiki/scrape/bonus/fetch-bonus.mjs</code> 의 출력 JSON을 붙여넣고
            제출하면 검토 큐에 들어갑니다.
          </p>
          <CreateJobClient />
        </div>
      )}

      <table className="w-full text-left text-sm">
        <thead className="border-b border-zinc-200 text-zinc-500">
          <tr>
            <th className="pb-2">생성일</th>
            <th className="pb-2">앨범</th>
            <th className="pb-2">소스</th>
            <th className="pb-2 text-right">후보 매장</th>
            <th className="pb-2">메모</th>
            <th className="pb-2"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((j) => (
            <tr key={j.id} className="border-b border-zinc-100 align-top">
              <td className="py-2 whitespace-nowrap text-zinc-500">
                {new Date(j.createdAt).toLocaleString("ko-KR", {
                  timeZone: "Asia/Seoul",
                })}
              </td>
              <td className="py-2">
                {j.album ? (
                  <Link
                    href={`/admin/albums/${j.album.id}/edit`}
                    className="text-blue-600 hover:underline"
                  >
                    {j.album.originalTitle}
                  </Link>
                ) : (
                  <span className="text-amber-700">미지정</span>
                )}
              </td>
              <td className="py-2 max-w-[16rem] truncate text-xs text-zinc-500">
                {j.sourceUrl ? (
                  <a
                    href={j.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    {j.sourceUrl}
                  </a>
                ) : (
                  "—"
                )}
              </td>
              <td className="py-2 text-right text-zinc-500">
                {j.listingCount}
              </td>
              <td className="py-2 max-w-[16rem] truncate text-xs text-zinc-500">
                {j.notes ?? "—"}
              </td>
              <td className="py-2 text-right whitespace-nowrap">
                <Link
                  href={`/admin/album-bonuses/import-review/${j.id}`}
                  className="text-blue-600 hover:underline"
                >
                  {status === "pending" ? "검토" : "보기"}
                </Link>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={6} className="py-6 text-center text-zinc-400">
                작업이 없습니다.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
