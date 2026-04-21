import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { serializeBigInt, pickLocaleTranslation } from "@/lib/utils";
import { displayNameWithFallback } from "@/lib/display";
import DeleteButton from "../DeleteButton";

export default async function SongsListPage() {
  const songs = await prisma.song.findMany({
    where: { isDeleted: false },
    include: {
      translations: true,
      artists: {
        include: { artist: { include: { translations: true } } },
      },
    },
    orderBy: { createdAt: "desc" },
  });
  const data = serializeBigInt(songs);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">곡 관리</h1>
        <Link
          href="/admin/songs/new"
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
        >
          새 곡
        </Link>
      </div>
      <table className="w-full text-left text-sm">
        <thead className="border-b border-zinc-200 text-zinc-500">
          <tr>
            <th className="pb-2">ID</th>
            <th className="pb-2">제목</th>
            <th className="pb-2">원제</th>
            <th className="pb-2">아티스트</th>
            <th className="pb-2"></th>
          </tr>
        </thead>
        <tbody>
          {data.map((song) => {
            const tr = pickLocaleTranslation(song.translations, "ko");
            const artistNames = song.artists
              .map((sa) =>
                displayNameWithFallback(sa.artist, sa.artist.translations, "ko")
              )
              .filter(Boolean)
              .join(", ");
            return (
              <tr key={song.id} className="border-b border-zinc-100">
                <td className="py-2 text-zinc-400">{song.id}</td>
                <td className="py-2 font-medium">
                  {tr?.title ?? song.originalTitle}
                  {song.variantLabel && (
                    <span className="ml-1 text-xs text-zinc-500">
                      ({song.variantLabel})
                    </span>
                  )}
                </td>
                <td className="py-2 text-zinc-500">{song.originalTitle}</td>
                <td className="py-2 text-zinc-500">{artistNames || "—"}</td>
                <td className="py-2 space-x-2">
                  <Link
                    href={`/admin/songs/${song.id}/edit`}
                    className="text-blue-600 hover:underline"
                  >
                    편집
                  </Link>
                  <DeleteButton url={`/api/admin/songs/${song.id}`} />
                </td>
              </tr>
            );
          })}
          {data.length === 0 && (
            <tr>
              <td colSpan={5} className="py-4 text-center text-zinc-400">
                등록된 곡이 없습니다.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
