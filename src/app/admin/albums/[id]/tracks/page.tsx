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
} from "@/lib/albumTrackVariants";
import TracksClient, { type TrackRow } from "./TracksClient";
import type { TrackPattern as ClientTrackPattern } from "@/components/admin/AlbumTrackFormModal";

type Props = { params: Promise<{ id: string }> };

// Korean labels for the row badges + getAlbumTrackTitle `t` callback.
// Inlined so this page doesn't need NextIntlClientProvider (admin
// layout intentionally omits it per CLAUDE.md). Mirrors the message
// keys under "AlbumTrack.variantSuffix.*" + "AlbumTrack.fallbackTrack"
// in messages/ko.json; if those change the literal here should
// follow.
const VARIANT_SUFFIX_KO: Record<string, string> = {
  "off-vocal": "오프 보컬",
  instrumental: "인스트루멘탈",
  karaoke: "가라오케",
  drama: "드라마",
  bgm: "BGM",
};

function adminT(key: string, values?: Record<string, string | number>): string {
  if (key.startsWith("AlbumTrack.variantSuffix.")) {
    const v = key.slice("AlbumTrack.variantSuffix.".length);
    return VARIANT_SUFFIX_KO[v] ?? v;
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
  const albumId = BigInt(id);

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
