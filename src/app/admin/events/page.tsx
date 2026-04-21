import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { serializeBigInt, formatDate } from "@/lib/utils";
import { displayNameWithFallback } from "@/lib/display";
import {
  getEventStatus,
  EVENT_STATUS_BADGE,
  type ResolvedEventStatus,
} from "@/lib/eventStatus";
import DeleteButton from "../DeleteButton";

// Admin UI is Korean-only and lives outside /[locale]/, so we can't use
// next-intl's getTranslations() here. Local labels match the rest of the
// admin surface (e.g. "이벤트 관리", "새 이벤트").
const STATUS_LABEL_KO: Record<ResolvedEventStatus, string> = {
  upcoming: "예정",
  ongoing: "진행 중",
  completed: "종료",
  cancelled: "취소",
};

export default async function EventsListPage() {
  const events = await prisma.event.findMany({
    where: { isDeleted: false },
    include: {
      translations: true,
      eventSeries: { include: { translations: true } },
    },
    orderBy: { date: "desc" },
  });
  const data = serializeBigInt(events);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">이벤트 관리</h1>
        <Link
          href="/admin/events/new"
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
        >
          새 이벤트
        </Link>
      </div>
      <table className="w-full text-left text-sm">
        <thead className="border-b border-zinc-200 text-zinc-500">
          <tr>
            <th className="pb-2">ID</th>
            <th className="pb-2">이름</th>
            <th className="pb-2">날짜</th>
            <th className="pb-2">시리즈</th>
            <th className="pb-2">상태</th>
            <th className="pb-2"></th>
          </tr>
        </thead>
        <tbody>
          {data.map((event) => {
            const name = displayNameWithFallback(
              event,
              event.translations,
              "ko"
            );
            const seriesName = event.eventSeries
              ? displayNameWithFallback(
                  event.eventSeries,
                  event.eventSeries.translations,
                  "ko"
                )
              : "";
            const resolved = getEventStatus(event);
            const badge = EVENT_STATUS_BADGE[resolved];
            return (
              <tr key={event.id} className="border-b border-zinc-100">
                <td className="py-2 text-zinc-400">{event.id}</td>
                <td className="py-2 font-medium">{name || "—"}</td>
                <td className="py-2 text-zinc-500">
                  {formatDate(event.date, "ko")}
                </td>
                <td className="py-2 text-zinc-500">
                  {seriesName || "—"}
                </td>
                <td className="py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs ${badge.color}`}>
                    {STATUS_LABEL_KO[resolved]}
                  </span>
                  {event.status !== resolved && (
                    <span className="ml-2 text-xs text-zinc-400">
                      (DB: {event.status})
                    </span>
                  )}
                </td>
                <td className="py-2 space-x-2">
                  <Link
                    href={`/admin/events/${event.id}/edit`}
                    className="text-blue-600 hover:underline"
                  >
                    편집
                  </Link>
                  <DeleteButton url={`/api/admin/events/${event.id}`} />
                </td>
              </tr>
            );
          })}
          {data.length === 0 && (
            <tr>
              <td colSpan={6} className="py-4 text-center text-zinc-400">
                등록된 이벤트가 없습니다.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
