import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { displayNameWithFallback } from "@/lib/display";
import DeleteButton from "../DeleteButton";

export default async function ArtistsListPage() {
  const artists = await prisma.artist.findMany({
    where: { isDeleted: false },
    include: {
      translations: true,
      parentArtist: { include: { translations: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  const data = serializeBigInt(artists);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">아티스트 관리</h1>
        <Link
          href="/admin/artists/new"
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
        >
          새 아티스트
        </Link>
      </div>
      <table className="w-full text-left text-sm">
        <thead className="border-b border-zinc-200 text-zinc-500">
          <tr>
            <th className="pb-2">ID</th>
            <th className="pb-2">이름</th>
            <th className="pb-2">타입</th>
            <th className="pb-2">상위 아티스트</th>
            <th className="pb-2"></th>
          </tr>
        </thead>
        <tbody>
          {data.map((artist) => {
            const name = displayNameWithFallback(
              artist,
              artist.translations,
              "ko"
            );
            const parentName = artist.parentArtist
              ? displayNameWithFallback(
                  artist.parentArtist,
                  artist.parentArtist.translations,
                  "ko"
                )
              : "";
            return (
              <tr key={artist.id} className="border-b border-zinc-100">
                <td className="py-2 text-zinc-400">{artist.id}</td>
                <td className="py-2 font-medium">{name || "—"}</td>
                <td className="py-2">{artist.type}</td>
                <td className="py-2 text-zinc-500">
                  {parentName || "—"}
                </td>
                <td className="py-2 space-x-2">
                  <Link
                    href={`/admin/artists/${artist.id}/edit`}
                    className="text-blue-600 hover:underline"
                  >
                    편집
                  </Link>
                  <DeleteButton url={`/api/admin/artists/${artist.id}`} />
                </td>
              </tr>
            );
          })}
          {data.length === 0 && (
            <tr>
              <td colSpan={5} className="py-4 text-center text-zinc-400">
                등록된 아티스트가 없습니다.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
