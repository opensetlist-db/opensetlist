import Link from "next/link";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { serializeBigInt, formatDate } from "@/lib/utils";
import { displayNameWithFallback, displayOriginalTitle } from "@/lib/display";

const ROW_LIMIT = 200;

// Mirror of the same shape used in /admin/reactions/page.tsx. Both
// pages render event labels identically; worth lifting to a shared
// helper once a third admin page needs it — premature today.
const eventSelect = {
  id: true,
  date: true,
  originalName: true,
  originalShortName: true,
  originalLanguage: true,
  translations: {
    select: { locale: true, name: true, shortName: true },
  },
} as const satisfies Prisma.EventSelect;

const songSelect = {
  id: true,
  isDeleted: true,
  originalTitle: true,
  originalLanguage: true,
  variantLabel: true,
  translations: {
    select: { locale: true, title: true, variantLabel: true },
  },
} as const satisfies Prisma.SongSelect;

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

function renderSongTitle(song: {
  originalTitle: string;
  originalLanguage: string;
  variantLabel: string | null;
  translations: { locale: string; title: string; variantLabel: string | null }[];
}) {
  return displayOriginalTitle(song, song.translations, "ko").main;
}

export default async function WishesAdminPage() {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [feedRowsRaw, topSongs, topEvents] = await Promise.all([
    prisma.songWish.findMany({
      include: {
        event: { select: eventSelect },
        song: { select: songSelect },
      },
      orderBy: { createdAt: "desc" },
      take: ROW_LIMIT,
    }),
    prisma.songWish.groupBy({
      by: ["songId"],
      where: { createdAt: { gte: sevenDaysAgo } },
      _count: true,
      orderBy: { _count: { songId: "desc" } },
      take: 5,
    }),
    prisma.songWish.groupBy({
      by: ["eventId"],
      where: { createdAt: { gte: sevenDaysAgo } },
      _count: true,
      orderBy: { _count: { eventId: "desc" } },
      take: 5,
    }),
  ]);

  // Resolve groupBy results back to displayable rows. groupBy returns
  // (songId|eventId, count) tuples in count-desc order, but the
  // follow-up findMany doesn't preserve that order — reconcile via
  // Map lookup keyed on serialized BigInt (mirrors the pattern at
  // /admin/reactions/page.tsx:148-164).
  const topSongIds = topSongs.map((r) => r.songId);
  const topEventIds = topEvents.map((r) => r.eventId);

  const [topSongDetailsRaw, topEventDetailsRaw] = await Promise.all([
    topSongIds.length
      ? prisma.song.findMany({
          where: { id: { in: topSongIds } },
          select: songSelect,
        })
      : Promise.resolve([]),
    topEventIds.length
      ? prisma.event.findMany({
          where: { id: { in: topEventIds } },
          select: eventSelect,
        })
      : Promise.resolve([]),
  ]);

  const songDetailsById = new Map(
    topSongDetailsRaw.map((s) => [s.id.toString(), s])
  );
  const eventDetailsById = new Map(
    topEventDetailsRaw.map((e) => [e.id.toString(), e])
  );

  const topSongsOrdered = topSongs
    .map((r) => ({
      count: r._count,
      detail: songDetailsById.get(r.songId.toString()),
    }))
    .filter(
      (row): row is { count: number; detail: NonNullable<typeof row.detail> } =>
        !!row.detail
    );
  const topEventsOrdered = topEvents
    .map((r) => ({
      count: r._count,
      detail: eventDetailsById.get(r.eventId.toString()),
    }))
    .filter(
      (row): row is { count: number; detail: NonNullable<typeof row.detail> } =>
        !!row.detail
    );

  const feedRows = serializeBigInt(feedRowsRaw);
  const topSongsSerialized = serializeBigInt(topSongsOrdered);
  const topEventsSerialized = serializeBigInt(topEventsOrdered);

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-2xl font-bold">희망곡 활동</h1>
      </div>

      {/* Prediction-analytics gap callout — sets operator expectation
          so they don't wonder why there's no "예상곡" surface here.
          Predictions are localStorage-only at v0.13.x (see
          prisma/schema.prisma SongWish comment block); a server-side
          surface arrives with Phase 2 or via GA4 Reporting API. */}
      <div className="mb-4 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
        예상곡(prediction) 사용량은 localStorage 전용이라 DB 집계가 없습니다.
        GA4 이벤트(<code className="font-mono">predict_add</code>,{" "}
        <code className="font-mono">predict_reorder</code>,{" "}
        <code className="font-mono">predict_lock_view</code>)로만 추적되며,
        Phase 2에서 서버 측 영속화 또는 GA4 Reporting API 통합 시 이 페이지에
        추가됩니다.
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <section className="rounded-lg border border-zinc-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-zinc-700">
            최근 7일 — 인기 희망곡 TOP 5
          </h2>
          {topSongsSerialized.length === 0 ? (
            <p className="text-sm text-zinc-400">활동 없음</p>
          ) : (
            <ol className="space-y-2 text-sm">
              {topSongsSerialized.map((row, i) => (
                <li key={i} className="flex items-baseline gap-2">
                  <span className="font-mono text-xs text-zinc-400">
                    {i + 1}.
                  </span>
                  <span className="flex-1 text-zinc-700">
                    {row.detail.isDeleted && (
                      <span className="mr-1 rounded-full bg-zinc-200 px-2 py-0.5 text-xs text-zinc-600">
                        [삭제]
                      </span>
                    )}
                    <span className="font-medium">
                      {renderSongTitle(row.detail)}
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
            최근 7일 — 활동 많은 이벤트 TOP 5
          </h2>
          {topEventsSerialized.length === 0 ? (
            <p className="text-sm text-zinc-400">활동 없음</p>
          ) : (
            <ol className="space-y-2 text-sm">
              {topEventsSerialized.map((row, i) => (
                <li key={i} className="flex items-baseline gap-2">
                  <span className="font-mono text-xs text-zinc-400">
                    {i + 1}.
                  </span>
                  <span className="flex-1 text-zinc-700">
                    <Link
                      href={`/ko/events/${row.detail.id}`}
                      className="hover:underline"
                    >
                      {renderEventLabel(row.detail)}
                    </Link>
                  </span>
                  <span className="whitespace-nowrap text-zinc-500">
                    {row.count}건
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
            <th className="pb-2">시각</th>
          </tr>
        </thead>
        <tbody>
          {feedRows.map((r) => (
            <tr key={r.id} className="border-b border-zinc-100 align-top">
              <td className="py-2 text-zinc-700">
                <Link
                  href={`/ko/events/${r.event.id}`}
                  className="hover:underline"
                >
                  {renderEventLabel(r.event)}
                </Link>
              </td>
              <td className="py-2 text-zinc-700">
                {r.song.isDeleted && (
                  <span className="mr-1 rounded-full bg-zinc-200 px-2 py-0.5 text-xs text-zinc-600">
                    [삭제]
                  </span>
                )}
                {renderSongTitle(r.song)}
              </td>
              <td className="py-2 text-zinc-500">
                {formatDate(r.createdAt, "ko")}
              </td>
            </tr>
          ))}
          {feedRows.length === 0 && (
            <tr>
              <td colSpan={3} className="py-4 text-center text-zinc-400">
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
