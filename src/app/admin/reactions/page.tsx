import Link from "next/link";
import { ReactionType } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { serializeBigInt, formatDate } from "@/lib/utils";
import { displayNameWithFallback, displayOriginalTitle } from "@/lib/display";
import AnonIdChip from "./AnonIdChip";

type Filter = "all" | ReactionType;

const TABS: { key: Filter; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "waiting", label: "😭 기다렸어" },
  { key: "best", label: "🔥 최고" },
  { key: "surprise", label: "😱 깜짝" },
  { key: "moved", label: "🩷 감동" },
];

const REACTION_LABELS: Record<ReactionType, string> = {
  waiting: "😭 기다렸어",
  best: "🔥 최고",
  surprise: "😱 깜짝",
  moved: "🩷 감동",
};

const ROW_LIMIT = 200;

function resolveFilter(value: string | undefined): Filter {
  if (
    value === "waiting" ||
    value === "best" ||
    value === "surprise" ||
    value === "moved" ||
    value === "all"
  ) {
    return value;
  }
  return "all";
}

type SearchParams = Promise<{ type?: string }>;

const eventSelect = {
  id: true,
  date: true,
  originalName: true,
  originalShortName: true,
  originalLanguage: true,
  translations: {
    select: { locale: true, name: true, shortName: true },
  },
} as const;

const setlistItemSelect = {
  id: true,
  isDeleted: true,
  event: { select: eventSelect },
  songs: {
    orderBy: { order: "asc" },
    select: {
      order: true,
      song: {
        select: {
          id: true,
          originalTitle: true,
          originalLanguage: true,
          variantLabel: true,
          translations: {
            select: { locale: true, title: true, variantLabel: true },
          },
        },
      },
    },
  },
} as const satisfies Prisma.SetlistItemSelect;

function renderEventLabel(event: {
  id: string | number | bigint;
  date: Date | string | null;
  originalName: string | null;
  originalShortName: string | null;
  originalLanguage: string;
  translations: { locale: string; name: string; shortName: string | null }[];
}) {
  const name = displayNameWithFallback(event, event.translations, "ko");
  const dateStr = formatDate(event.date, "ko");
  if (!name) return `#${event.id} (${dateStr})`;
  return `${name} (${dateStr})`;
}

function joinSongTitles(
  songs: {
    song: {
      originalTitle: string;
      originalLanguage: string;
      variantLabel: string | null;
      translations: { locale: string; title: string; variantLabel: string | null }[];
    };
  }[]
): string {
  if (songs.length === 0) return "—";
  return songs
    .map((s) => displayOriginalTitle(s.song, s.song.translations, "ko").main)
    .join(" + ");
}

export default async function ReactionsAdminPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const filter = resolveFilter(sp.type);
  const reactionTypeWhere =
    filter === "all" ? {} : { reactionType: filter };

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [feedRowsRaw, topItems, topAnons] = await Promise.all([
    prisma.setlistItemReaction.findMany({
      where: reactionTypeWhere,
      include: { setlistItem: { select: setlistItemSelect } },
      orderBy: { createdAt: "desc" },
      take: ROW_LIMIT,
    }),
    prisma.setlistItemReaction.groupBy({
      by: ["setlistItemId"],
      where: { createdAt: { gte: sevenDaysAgo }, ...reactionTypeWhere },
      _count: true,
      orderBy: { _count: { setlistItemId: "desc" } },
      take: 5,
    }),
    prisma.setlistItemReaction.groupBy({
      by: ["anonId"],
      where: {
        createdAt: { gte: oneDayAgo },
        anonId: { not: null },
        ...reactionTypeWhere,
      },
      _count: true,
      orderBy: { _count: { anonId: "desc" } },
      take: 5,
    }),
  ]);

  const topItemIds = topItems.map((r) => r.setlistItemId);
  const topItemDetailsRaw = topItemIds.length
    ? await prisma.setlistItem.findMany({
        where: { id: { in: topItemIds } },
        select: setlistItemSelect,
      })
    : [];

  const detailsById = new Map(
    topItemDetailsRaw.map((d) => [d.id.toString(), d])
  );
  const topItemsOrdered = topItems
    .map((r) => ({
      count: r._count,
      detail: detailsById.get(r.setlistItemId.toString()),
    }))
    .filter((row): row is { count: number; detail: NonNullable<typeof row.detail> } => !!row.detail);

  const feedRows = serializeBigInt(feedRowsRaw);
  const topItemsSerialized = serializeBigInt(topItemsOrdered);

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-2xl font-bold">감정 태그 활동</h1>
      </div>
      <nav className="mb-4 flex gap-2 border-b border-zinc-200">
        {TABS.map((tab) => {
          const active = tab.key === filter;
          return (
            <Link
              key={tab.key}
              href={`/admin/reactions?type=${tab.key}`}
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

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <section className="rounded-lg border border-zinc-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-zinc-700">
            최근 7일 — 반응 많은 곡 TOP 5
          </h2>
          {topItemsSerialized.length === 0 ? (
            <p className="text-sm text-zinc-400">활동 없음</p>
          ) : (
            <ol className="space-y-2 text-sm">
              {topItemsSerialized.map((row, i) => (
                <li key={i} className="flex items-baseline gap-2">
                  <span className="font-mono text-xs text-zinc-400">
                    {i + 1}.
                  </span>
                  <span className="flex-1 text-zinc-700">
                    <span className="font-medium">
                      {joinSongTitles(row.detail.songs)}
                    </span>
                    <span className="text-zinc-500">
                      {" — "}
                      <Link
                        href={`/ko/events/${row.detail.event.id}`}
                        className="hover:underline"
                      >
                        {renderEventLabel(row.detail.event)}
                      </Link>
                    </span>
                  </span>
                  <span className="whitespace-nowrap text-zinc-500">
                    {row.count}건
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="rounded-lg border border-zinc-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-zinc-700">
            최근 24시간 — 반응 수 상위 anonId TOP 5
          </h2>
          {topAnons.length === 0 ? (
            <p className="text-sm text-zinc-400">활동 없음</p>
          ) : (
            <ol className="space-y-2 text-sm">
              {topAnons.map((row, i) => (
                <li key={i} className="flex items-baseline gap-2">
                  <span className="font-mono text-xs text-zinc-400">
                    {i + 1}.
                  </span>
                  <span className="flex-1">
                    <AnonIdChip id={row.anonId!} />
                  </span>
                  <span className="whitespace-nowrap text-zinc-500">
                    {row._count}건
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <table className="w-full text-left text-sm">
        <thead className="border-b border-zinc-200 text-zinc-500">
          <tr>
            <th className="pb-2">이벤트</th>
            <th className="pb-2">곡</th>
            <th className="pb-2">타입</th>
            <th className="pb-2">anonId</th>
            <th className="pb-2">시각</th>
          </tr>
        </thead>
        <tbody>
          {feedRows.map((r) => {
            const item = r.setlistItem;
            return (
              <tr key={r.id} className="border-b border-zinc-100 align-top">
                <td className="py-2 text-zinc-700">
                  <Link
                    href={`/ko/events/${item.event.id}`}
                    className="hover:underline"
                  >
                    {renderEventLabel(item.event)}
                  </Link>
                </td>
                <td className="py-2 text-zinc-700">
                  {item.isDeleted && (
                    <span className="mr-1 rounded-full bg-zinc-200 px-2 py-0.5 text-xs text-zinc-600">
                      [삭제]
                    </span>
                  )}
                  {joinSongTitles(item.songs)}
                </td>
                <td className="py-2 text-zinc-700">
                  {REACTION_LABELS[r.reactionType]}
                </td>
                <td className="py-2">
                  {r.anonId ? (
                    <AnonIdChip id={r.anonId} />
                  ) : (
                    <span className="text-zinc-400">—</span>
                  )}
                </td>
                <td className="py-2 text-zinc-500">
                  {formatDate(r.createdAt, "ko")}
                </td>
              </tr>
            );
          })}
          {feedRows.length === 0 && (
            <tr>
              <td colSpan={5} className="py-4 text-center text-zinc-400">
                최근 활동이 없습니다.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {feedRows.length === ROW_LIMIT && (
        <p className="mt-3 text-xs text-zinc-400">최근 {ROW_LIMIT}개 표시</p>
      )}
    </div>
  );
}
