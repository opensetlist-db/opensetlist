import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { serializeBigInt, pickLocaleTranslation } from "@/lib/utils";
import { displayNameWithFallback } from "@/lib/display";

type SortKey = "triage" | "recent" | "title";

// Number of binary signals counted by completenessScore — kept in
// one place so the score and the badge max stay tied. Adding a
// sixth signal means bumping both this constant and the body of
// completenessScore in lockstep.
const COMPLETENESS_MAX = 5;

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "triage", label: "정보 부족순 (기본)" },
  { value: "recent", label: "최근 등록순" },
  { value: "title", label: "원제순" },
];

function parseSort(raw: string | undefined): SortKey {
  if (raw === "recent" || raw === "title") return raw;
  return "triage";
}

// Triage completeness score — lower = less filled, sorted first.
// Five binary signals so the operator can see at a glance which
// albums are missing what. Tie-break by createdAt desc.
function completenessScore(album: {
  imageUrl: string | null;
  translations: { locale: string }[];
  listings: { productUrl: string | null; _count: { bonuses: number } }[];
}): number {
  const hasImage = album.imageUrl ? 1 : 0;
  const hasListing = album.listings.length > 0 ? 1 : 0;
  const hasProductUrl = album.listings.some((l) => l.productUrl) ? 1 : 0;
  const hasBonus = album.listings.some((l) => l._count.bonuses > 0) ? 1 : 0;
  const hasTwoLocales = album.translations.length >= 2 ? 1 : 0;
  return hasImage + hasListing + hasProductUrl + hasBonus + hasTwoLocales;
}

type Props = {
  searchParams: Promise<{ sort?: string }>;
};

export default async function AlbumsListPage({ searchParams }: Props) {
  const params = await searchParams;
  const sort = parseSort(params.sort);

  const albums = await prisma.album.findMany({
    include: {
      translations: true,
      artists: {
        include: { artist: { include: { translations: true } } },
      },
      listings: {
        select: {
          productUrl: true,
          _count: { select: { bonuses: true } },
        },
      },
      _count: { select: { tracks: true, listings: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  // Sort in JS — completeness is a derived score that doesn't map
  // cleanly to SQL ORDER BY, and album volume is small (low hundreds).
  const sorted = (() => {
    if (sort === "recent") {
      return albums;
    }
    if (sort === "title") {
      return [...albums].sort((a, b) =>
        a.originalTitle.localeCompare(b.originalTitle, "ja"),
      );
    }
    // triage default
    return [...albums].sort((a, b) => {
      const diff = completenessScore(a) - completenessScore(b);
      if (diff !== 0) return diff;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });
  })();

  const data = serializeBigInt(sorted);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">앨범 관리</h1>
        <SortLinks current={sort} />
      </div>
      <table className="w-full text-left text-sm">
        <thead className="border-b border-zinc-200 text-zinc-500">
          <tr>
            <th className="pb-2">ID</th>
            <th className="pb-2">제목</th>
            <th className="pb-2">원제</th>
            <th className="pb-2">타입</th>
            <th className="pb-2">아티스트</th>
            <th className="pb-2 text-right">트랙</th>
            <th className="pb-2 text-right">매장</th>
            <th className="pb-2 text-right">특전</th>
            <th className="pb-2 text-right">정보도</th>
            <th className="pb-2"></th>
          </tr>
        </thead>
        <tbody>
          {data.map((album) => {
            const tr = pickLocaleTranslation(album.translations, "ko");
            const artistNames = album.artists
              .map((aa) =>
                displayNameWithFallback(
                  aa.artist,
                  aa.artist.translations,
                  "ko",
                ),
              )
              .filter(Boolean)
              .join(", ");
            const bonusCount = album.listings.reduce(
              (sum: number, l: { _count: { bonuses: number } }) =>
                sum + l._count.bonuses,
              0,
            );
            const score = completenessScore(album);
            return (
              <tr key={album.id} className="border-b border-zinc-100">
                <td className="py-2 text-zinc-400">{album.id}</td>
                <td className="py-2 font-medium">
                  {tr?.title ?? album.originalTitle}
                </td>
                <td className="py-2 text-zinc-500">{album.originalTitle}</td>
                <td className="py-2 text-zinc-500">{album.type}</td>
                <td className="py-2 text-zinc-500">{artistNames || "—"}</td>
                <td className="py-2 text-right text-zinc-500">
                  {album._count.tracks}
                </td>
                <td className="py-2 text-right text-zinc-500">
                  {album._count.listings}
                </td>
                <td className="py-2 text-right text-zinc-500">{bonusCount}</td>
                <td className="py-2 text-right">
                  <CompletenessBadge score={score} />
                </td>
                <td className="space-x-2 py-2 whitespace-nowrap">
                  <Link
                    href={`/admin/albums/${album.id}/edit`}
                    className="text-blue-600 hover:underline"
                  >
                    편집
                  </Link>
                  <Link
                    href={`/admin/albums/${album.id}/listings`}
                    className="text-blue-600 hover:underline"
                  >
                    매장
                  </Link>
                  <Link
                    href={`/admin/albums/${album.id}/tracks`}
                    className="text-blue-600 hover:underline"
                  >
                    수록곡
                  </Link>
                </td>
              </tr>
            );
          })}
          {data.length === 0 && (
            <tr>
              <td colSpan={10} className="py-4 text-center text-zinc-400">
                등록된 앨범이 없습니다. CSV 가져오기 또는 Niji 시드를 확인해
                보세요.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// Sort selector — server component avoids a "use client" island just
// for navigation. Each link replaces the ?sort= query param; the
// adjacent <select> is decorative until we want a richer UI.
function SortLinks({ current }: { current: SortKey }) {
  return (
    <div className="ml-2 flex gap-2 text-xs">
      {SORT_OPTIONS.map((opt) => (
        <Link
          key={opt.value}
          href={opt.value === "triage" ? "/admin/albums" : `/admin/albums?sort=${opt.value}`}
          className={
            opt.value === current
              ? "font-semibold text-zinc-900 underline"
              : "text-zinc-500 hover:underline"
          }
        >
          {opt.label}
        </Link>
      ))}
    </div>
  );
}

function CompletenessBadge({ score }: { score: number }) {
  // 0..5 scale — 5 is fully filled, 0 is brand-new empty stub. Color
  // bands match the operator's mental model: red = needs attention,
  // amber = partial, green = done.
  let color: string;
  if (score <= 1) color = "bg-red-100 text-red-700";
  else if (score <= 3) color = "bg-amber-100 text-amber-700";
  else color = "bg-emerald-100 text-emerald-700";
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${color}`}
    >
      {score}/{COMPLETENESS_MAX}
    </span>
  );
}
