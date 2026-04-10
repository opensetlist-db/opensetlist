import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { serializeBigInt, pickTranslation } from "@/lib/utils";
import DeleteButton from "../DeleteButton";

export default async function EventSeriesListPage() {
  const series = await prisma.eventSeries.findMany({
    where: { isDeleted: false },
    include: {
      translations: true,
      artist: { include: { translations: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  const data = serializeBigInt(series);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">시리즈 관리</h1>
        <Link
          href="/admin/event-series/new"
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
        >
          새 시리즈
        </Link>
      </div>
      <table className="w-full text-left text-sm">
        <thead className="border-b border-zinc-200 text-zinc-500">
          <tr>
            <th className="pb-2">ID</th>
            <th className="pb-2">이름</th>
            <th className="pb-2">타입</th>
            <th className="pb-2">아티스트</th>
            <th className="pb-2"></th>
          </tr>
        </thead>
        <tbody>
          {data.map((s) => {
            const tr = pickTranslation(s.translations, "ko");
            const artistTr = s.artist
              ? pickTranslation(s.artist.translations, "ko")
              : null;
            return (
              <tr key={s.id} className="border-b border-zinc-100">
                <td className="py-2 text-zinc-400">{s.id}</td>
                <td className="py-2 font-medium">{tr?.name ?? "—"}</td>
                <td className="py-2">{s.type}</td>
                <td className="py-2 text-zinc-500">
                  {artistTr?.name ?? s.organizerName ?? "—"}
                </td>
                <td className="py-2 space-x-2">
                  <Link
                    href={`/admin/event-series/${s.id}/edit`}
                    className="text-blue-600 hover:underline"
                  >
                    편집
                  </Link>
                  <DeleteButton url={`/api/admin/event-series/${s.id}`} />
                </td>
              </tr>
            );
          })}
          {data.length === 0 && (
            <tr>
              <td colSpan={5} className="py-4 text-center text-zinc-400">
                등록된 시리즈가 없습니다.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
