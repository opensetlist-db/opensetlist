import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { serializeBigInt, pickLocaleTranslation } from "@/lib/utils";
import {
  getAlbumTrackTitle,
  type EnrichedAlbumTrack,
} from "@/lib/albumTrackTitle";
import {
  isPattern2AlbumTrackVariant,
  isPattern3AlbumTrackVariant,
  ALBUM_TRACK_VARIANT_SUFFIX_KO,
} from "@/lib/albumTrackVariants";
import TracksClient, { type TrackRow } from "./TracksClient";
import type { TrackPattern as ClientTrackPattern } from "@/lib/albumTrackTypes";

type Props = { params: Promise<{ id: string }> };

// `adminT` is the `t` callback that getAlbumTrackTitle expects, but
// resolved against an inline Korean map instead of next-intl —
// admin layout omits NextIntlClientProvider on purpose (CLAUDE.md
// admin-i18n exemption). The variant labels live with the allowlist
// in @/lib/albumTrackVariants so import + admin + display stay in
// lockstep; the fallbackTrack literal mirrors messages/ko.json.
function adminT(
  key: string,
  values?: Record<string, string | number>,
): string {
  if (key.startsWith("AlbumTrack.variantSuffix.")) {
    const v = key.slice("AlbumTrack.variantSuffix.".length);
    return (
      ALBUM_TRACK_VARIANT_SUFFIX_KO[
        v as keyof typeof ALBUM_TRACK_VARIANT_SUFFIX_KO
      ] ?? v
    );
  }
  if (key === "AlbumTrack.fallbackTrack") {
    return `트랙 ${values?.number ?? "?"}`;
  }
  return key;
}

function classifyPattern(t: {
  songId: bigint | number | null;
  parentSongId: bigint | number | null;
  variant: string | null;
}): ClientTrackPattern {
  if (t.songId != null) return "vocal";
  if (t.variant && isPattern2AlbumTrackVariant(t.variant)) {
    return "off_vocal_w_parent";
  }
  if (t.variant && isPattern3AlbumTrackVariant(t.variant)) return "direct";
  // Defensive fallback for stale/unknown variant strings — render as
  // direct so the row still appears in the table; the operator can
  // edit to repair.
  return "direct";
}

const PATTERN_BADGES: Record<ClientTrackPattern, string> = {
  vocal: "Vocal",
  off_vocal_w_parent: "Off-Vocal",
  direct: "Drama/BGM",
};

export default async function AlbumTracksPage({ params }: Props) {
  const { id } = await params;
  let albumId: bigint;
  try {
    albumId = BigInt(id);
  } catch {
    notFound();
  }

  const album = await prisma.album.findUnique({
    where: { id: albumId },
    select: {
      id: true,
      originalTitle: true,
      translations: { select: { locale: true, title: true } },
    },
  });
  if (!album) notFound();

  const tracks = await prisma.albumTrack.findMany({
    where: { albumId },
    include: {
      song: { include: { translations: true } },
      parentSong: { include: { translations: true } },
      translations: true,
    },
    orderBy: [{ discNumber: "asc" }, { trackNumber: "asc" }],
  });

  const rows: TrackRow[] = tracks.map((t) => {
    const pattern = classifyPattern(t);
    const displayTitle = getAlbumTrackTitle(
      t as EnrichedAlbumTrack,
      "ko",
      adminT,
    );
    const songForLabel = t.song ?? t.parentSong;
    const songLabel = songForLabel
      ? (songForLabel.translations.find((tr) => tr.locale === "ko")?.title ??
        songForLabel.originalTitle)
      : "";
    return {
      id: t.id,
      discNumber: t.discNumber,
      trackNumber: t.trackNumber,
      pattern,
      patternBadge: PATTERN_BADGES[pattern],
      displayTitle,
      songId: t.songId !== null ? Number(t.songId) : null,
      parentSongId: t.parentSongId !== null ? Number(t.parentSongId) : null,
      variant: t.variant,
      title: t.title,
      titleLanguage: t.titleLanguage,
      translations: t.translations.map(
        (tr: { locale: string; title: string }) => ({
          locale: tr.locale,
          title: tr.title,
        }),
      ),
      selectedSongLabel: songLabel,
    };
  });

  const tr = pickLocaleTranslation(album.translations, "ko");
  const albumTitle = tr?.title ?? album.originalTitle;

  // serializeBigInt on the rows would already have produced the
  // number ids above; pass through for the client island.
  const serialized = serializeBigInt(rows);

  return (
    <div>
      <div className="mb-2 text-sm">
        <Link
          href={`/admin/albums/${id}/edit`}
          className="text-blue-600 hover:underline"
        >
          ← {albumTitle}
        </Link>
      </div>
      <TracksClient albumId={String(album.id)} tracks={serialized} />
    </div>
  );
}
