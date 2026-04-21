import Link from "next/link";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { serializeBigInt, formatDate } from "@/lib/utils";
import { displayNameWithFallback } from "@/lib/display";
import DeleteImpressionButton from "./DeleteImpressionButton";
import RestoreImpressionButton from "./RestoreImpressionButton";

type Filter = "hidden" | "live" | "deleted" | "all";

const TABS: { key: Filter; label: string }[] = [
  { key: "hidden", label: "숨김" },
  { key: "live", label: "정상" },
  { key: "deleted", label: "삭제" },
  { key: "all", label: "전체" },
];

const ROW_LIMIT = 200;

function resolveFilter(value: string | undefined): Filter {
  if (value === "live" || value === "deleted" || value === "all") return value;
  return "hidden";
}

function whereFor(
  filter: Filter,
): Prisma.EventImpressionWhereInput {
  switch (filter) {
    case "live":
      return { supersededAt: null, isDeleted: false, isHidden: false };
    case "deleted":
      return { supersededAt: null, isDeleted: true };
    case "all":
      return { supersededAt: null };
    case "hidden":
    default:
      return { supersededAt: null, isDeleted: false, isHidden: true };
  }
}

function orderFor(
  filter: Filter,
): Prisma.EventImpressionOrderByWithRelationInput[] {
  if (filter === "hidden") {
    return [{ reportCount: "desc" }, { createdAt: "desc" }];
  }
  if (filter === "deleted") {
    return [{ deletedAt: "desc" }, { createdAt: "desc" }];
  }
  return [{ createdAt: "desc" }];
}

type SearchParams = Promise<{ filter?: string }>;

export default async function ImpressionsAdminPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const filter = resolveFilter(sp.filter);

  const rows = await prisma.eventImpression.findMany({
    where: whereFor(filter),
    include: {
      event: {
        select: {
          id: true,
          date: true,
          originalName: true,
          originalShortName: true,
          originalLanguage: true,
          translations: {
            select: { locale: true, name: true, shortName: true },
          },
        },
      },
    },
    orderBy: orderFor(filter),
    take: ROW_LIMIT,
  });
  const data = serializeBigInt(rows);

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-2xl font-bold">한줄평 관리</h1>
      </div>
      <nav className="mb-4 flex gap-2 border-b border-zinc-200">
        {TABS.map((tab) => {
          const active = tab.key === filter;
          return (
            <Link
              key={tab.key}
              href={`/admin/impressions?filter=${tab.key}`}
              className={
                active
                  ? "border-b-2 border-blue-600 px-3 py-2 text-sm font-medium text-blue-600"
                  : "px-3 py-2 text-sm text-zinc-600 hover:text-zinc-900"
              }
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
      <table className="w-full text-left text-sm">
        <thead className="border-b border-zinc-200 text-zinc-500">
          <tr>
            <th className="pb-2">이벤트</th>
            <th className="pb-2">내용</th>
            <th className="pb-2">Locale</th>
            <th className="pb-2">작성</th>
            <th className="pb-2">신고</th>
            <th className="pb-2">상태</th>
            <th className="pb-2">관리</th>
          </tr>
        </thead>
        <tbody>
          {data.map((imp) => {
            const name = displayNameWithFallback(
              imp.event,
              imp.event.translations,
              "ko"
            );
            const eventLabel = name
              ? `${name} (${formatDate(imp.event.date, "ko")})`
              : `#${imp.event.id}`;
            const status = imp.isDeleted
              ? { label: "삭제", color: "bg-zinc-200 text-zinc-700" }
              : imp.isHidden
                ? { label: "숨김", color: "bg-amber-100 text-amber-800" }
                : { label: "정상", color: "bg-emerald-100 text-emerald-800" };
            const preview =
              imp.content.length > 80
                ? `${imp.content.slice(0, 80)}…`
                : imp.content;
            return (
              <tr key={imp.id} className="border-b border-zinc-100 align-top">
                <td className="py-2 text-zinc-700">
                  <Link
                    href={`/ko/events/${imp.event.id}`}
                    className="hover:underline"
                  >
                    {eventLabel}
                  </Link>
                </td>
                <td className="py-2">{preview}</td>
                <td className="py-2 text-zinc-500">{imp.locale}</td>
                <td className="py-2 text-zinc-500">
                  {formatDate(imp.createdAt, "ko")}
                </td>
                <td className="py-2 text-zinc-700">{imp.reportCount}</td>
                <td className="py-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${status.color}`}
                  >
                    {status.label}
                  </span>
                </td>
                <td className="py-2">
                  {imp.isDeleted ? (
                    <RestoreImpressionButton
                      rootImpressionId={imp.rootImpressionId}
                    />
                  ) : (
                    <DeleteImpressionButton
                      rootImpressionId={imp.rootImpressionId}
                    />
                  )}
                </td>
              </tr>
            );
          })}
          {data.length === 0 && (
            <tr>
              <td colSpan={7} className="py-4 text-center text-zinc-400">
                표시할 한줄평이 없습니다.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {data.length === ROW_LIMIT && (
        <p className="mt-3 text-xs text-zinc-400">최근 {ROW_LIMIT}개 표시</p>
      )}
    </div>
  );
}
