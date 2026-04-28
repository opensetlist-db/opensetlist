"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  displayNameWithFallback,
  displayOriginalTitle,
} from "@/lib/display";
import { trackEvent } from "@/lib/analytics";
import { ReactionButtons } from "@/components/ReactionButtons";
import type { LiveSetlistItem } from "@/components/LiveSetlist";
import type { ReactionCountsMap } from "@/hooks/useSetlistPolling";
import { colors } from "@/styles/tokens";

// Stable reference for items with no reactions yet — without this, every
// render produces a fresh `{}` and ReactionButtons' prev-prop guard would
// needlessly run setState every poll for those items.
const EMPTY_COUNTS: Record<string, number> = {};

// Non-song variants render their type label in a muted gray color
// (instead of opacity-dimming the whole row, which used to wash out
// borders and hover states too) and don't get reaction buttons.
const NON_SONG_TYPES = new Set(["mc", "video", "interval"]);

interface Props {
  item: LiveSetlistItem;
  index: number;
  reactionCounts: ReactionCountsMap;
  locale: string;
  eventId: string;
}

export function SetlistRow({
  item,
  index,
  reactionCounts,
  locale,
  eventId,
}: Props) {
  const t = useTranslations("Event");

  const songNames = item.songs.map((s) => {
    const { main, sub, variant } = displayOriginalTitle(
      s.song,
      s.song.translations,
      locale,
    );
    // Build the canonical href segment once. Schema declares
    // `Song.slug` as required + unique, but defensively handle the
    // empty-string case (some pre-redesign imports left it blank) by
    // dropping the slug segment entirely — the `[[...slug]]` catch-all
    // resolves on id alone, so `/songs/{id}` still routes correctly.
    const slugSegment = s.song.slug ? `/${s.song.slug}` : "";
    return {
      id: s.song.id,
      href: `/${locale}/songs/${s.song.id}${slugSegment}`,
      main,
      sub,
      variantLabel: variant,
    };
  });

  const performers = item.performers.map(
    (p) =>
      displayNameWithFallback(
        p.stageIdentity,
        p.stageIdentity.translations,
        locale,
      ) || t("unknownPerformer"),
  );

  const unitArtist =
    item.stageType !== "full_group" && item.artists?.[0]
      ? item.artists[0]
      : null;
  const unitArtistName = unitArtist
    ? displayNameWithFallback(
        unitArtist.artist,
        unitArtist.artist.translations,
        locale,
      )
    : "";

  const isNonSong = NON_SONG_TYPES.has(item.type);

  return (
    <li
      className="border-b border-zinc-100 pb-2 lg:grid lg:grid-cols-[36px_1fr_180px] lg:gap-3 lg:px-2 lg:py-2 lg:hover:bg-[var(--row-hover-bg)] lg:transition-colors lg:duration-[120ms]"
      // CSS variable funnels colors.bgSubtle into the hover Tailwind class.
      style={{ "--row-hover-bg": colors.bgSubtle } as React.CSSProperties}
    >
      <div className="flex items-start gap-3 lg:col-span-2">
        <span
          className="mt-0.5 w-6 shrink-0 pt-px text-right text-sm font-mono text-zinc-400 lg:w-9"
        >
          {index + 1}
        </span>
        <div className="flex-1 min-w-0">
          {/*
            Title row + reactions on one wrapping flex line. The
            ReactionButtons render inline at the row's end on wide
            viewports and wrap below the title on narrow ones — that's
            what `flex-wrap` is for. Non-song items skip the reactions
            entirely (early-return inside the conditional).
          */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <div className="min-w-0 flex-1">
              <SongTitleBlock
                songNames={songNames}
                itemType={item.type}
                position={item.position}
                eventId={eventId}
                t={t}
              />
            </div>
            {/*
              Reactions only render for song-typed items that actually
              have at least one song attached. An admin-created song
              row with no song assigned (placeholder) would otherwise
              POST reactions with an empty `songId`, breaking analytics
              tracking and the per-song aggregation downstream.
            */}
            {!isNonSong && songNames.length > 0 && (
              <ReactionButtons
                setlistItemId={String(item.id)}
                songId={String(item.songs[0].song.id)}
                eventId={eventId}
                initialCounts={reactionCounts[String(item.id)] ?? EMPTY_COUNTS}
              />
            )}
          </div>
          {!isNonSong && unitArtist && unitArtistName && (
            <UnitBadge
              artistColor={unitArtist.artist.color}
              locale={locale}
              artistId={unitArtist.artist.id}
              artistSlug={unitArtist.artist.slug}
              label={unitArtistName}
            />
          )}
          {!isNonSong && unitArtist && !unitArtistName && (
            <FallbackUnitBadge
              label={
                item.unitName ??
                t(`stageType.${item.stageType}` as Parameters<typeof t>[0])
              }
            />
          )}
        </div>
      </div>

      {/* Performers column — desktop only. Mobile drops the line
          entirely per operator preference (the title + reactions row
          carries enough context on narrow viewports). */}
      <div className="mt-1 hidden text-sm text-zinc-500 lg:block">
        {performers.length > 0 ? performers.join(", ") : null}
      </div>
    </li>
  );
}

function SongTitleBlock({
  songNames,
  itemType,
  position,
  eventId,
  t,
}: {
  songNames: Array<{
    id: number;
    href: string;
    main: string;
    sub: string | null;
    variantLabel: string | null;
  }>;
  itemType: string;
  position: number;
  eventId: string;
  t: ReturnType<typeof useTranslations<"Event">>;
}) {
  if (songNames.length === 0) {
    return (
      <div className="flex flex-wrap items-center gap-1">
        {itemType !== "song" ? (
          <span
            className="font-medium italic"
            style={{ color: colors.textMuted }}
          >
            {t(`itemType.${itemType}` as Parameters<typeof t>[0])}
          </span>
        ) : (
          <span style={{ color: colors.textMuted }}>{t("noSongAssigned")}</span>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {songNames.map((song, i) => (
        <span key={song.id}>
          {i > 0 && <span className="mx-1 text-zinc-400">+</span>}
          <Link
            href={song.href}
            onClick={() =>
              trackEvent("setlist_item_click", {
                song_id: String(song.id),
                event_id: eventId,
                position,
              })
            }
            className="font-medium hover:underline"
            style={{ color: colors.primary }}
          >
            {song.main}
          </Link>
          {song.sub && (
            <span className="ml-1 text-sm text-zinc-400">{song.sub}</span>
          )}
          {song.variantLabel && (
            <span className="ml-1 text-xs text-zinc-500">
              ({song.variantLabel})
            </span>
          )}
        </span>
      ))}
    </div>
  );
}

function UnitBadge({
  artistColor,
  locale,
  artistId,
  artistSlug,
  label,
}: {
  artistColor: string | null;
  locale: string;
  artistId: number;
  artistSlug: string;
  label: string;
}) {
  // Per handoff §3-2: bg = `${color}18` (9% alpha), text = color at full
  // opacity. Fallback to default zinc tokens when artist.color is null.
  const styled = artistColor
    ? { backgroundColor: `${artistColor}18`, color: artistColor }
    : undefined;
  return (
    <Link
      href={`/${locale}/artists/${artistId}/${artistSlug}`}
      className={`mt-1 inline-block rounded px-1.5 py-0.5 text-xs font-medium hover:underline ${
        styled ? "" : "bg-zinc-100 text-zinc-600"
      }`}
      style={styled}
    >
      {label}
    </Link>
  );
}

function FallbackUnitBadge({ label }: { label: string }) {
  return (
    <span className="mt-1 inline-block rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600">
      {label}
    </span>
  );
}
