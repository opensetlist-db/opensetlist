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
  vocal: "보컬",
  off_vocal_w_parent: "오프 보컬",
  direct: "드라마/BGM",
};

export default async function AlbumTracksPage({ params }: Props) {
  const { id } = await params;
  let albumId: bigint;
  try {
    albumId = BigInt(id);
  } catch {
    notFound();
  }

  // Both queries key off the same `albumId` known up front — fan
  // them out. The notFound() guard runs after destructuring; the
  // tracks result is discarded if the album turns out missing,
  // which is the cheaper trade for the latency-saving in the happy
  // path. Matches Promise.all in listings/page.tsx and bonuses/page.tsx.
  const [album, tracks] = await Promise.all([
    prisma.album.findUnique({
      where: { id: albumId },
      select: {
        id: true,
        originalTitle: true,
        translations: { select: { locale: true, title: true } },
      },
    }),
    prisma.albumTrack.findMany({
      where: { albumId },
      include: {
        song: { include: { translations: true } },
        parentSong: { include: { translations: true } },
        translations: true,
      },
      orderBy: [{ discNumber: "asc" }, { trackNumber: "asc" }],
    }),
  ]);
  if (!album) notFound();

  const rows: TrackRow[] = tracks.map((t) => {
    const pattern = classifyPattern(t);
    // EnrichedAlbumTrack is BigIntStringified-wrapped for the public
    // page's serialized payload (b04). This call site hands `t`
    // directly from Prisma (raw bigint / Date) — getAlbumTrackTitle
    // only reads string fields + nullable bigints in `if` checks, so
    // both shapes are runtime-compatible. The cast bridges the type
    // contracts without serialising the row again.
    const displayTitle = getAlbumTrackTitle(
      t as unknown as EnrichedAlbumTrack,
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
      // Stringify BigInt ids directly (no Number() round-trip) so
      // the precision survives JSON serialization. The server-side
      // parseBigInt accepts string ids on the way back in.
      songId: t.songId !== null ? t.songId.toString() : null,
      parentSongId:
        t.parentSongId !== null ? t.parentSongId.toString() : null,
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
