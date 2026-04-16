import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { serializeBigInt, pickTranslation, formatDate } from "@/lib/utils";
import { getEventStatus, EVENT_STATUS_BADGE } from "@/lib/eventStatus";
import DeleteButton from "../DeleteButton";

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
  const evT = await getTranslations("Event");

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
            const tr = pickTranslation(event.translations, "ko");
            const seriesTr = event.eventSeries
              ? pickTranslation(event.eventSeries.translations, "ko")
              : null;
            const badge = EVENT_STATUS_BADGE[getEventStatus(event)];
            return (
              <tr key={event.id} className="border-b border-zinc-100">
                <td className="py-2 text-zinc-400">{event.id}</td>
                <td className="py-2 font-medium">{tr?.name ?? "—"}</td>
                <td className="py-2 text-zinc-500">
                  {formatDate(event.date, "ko")}
                </td>
                <td className="py-2 text-zinc-500">
                  {seriesTr?.name ?? "—"}
                </td>
                <td className="py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs ${badge.color}`}>
                    {evT(badge.labelKey)}
                  </span>
                  <span className="ml-2 text-xs text-zinc-400">({event.status})</span>
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
