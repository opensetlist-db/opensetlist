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
import {
  SETLIST_DESKTOP_GRID_COLS,
  SETLIST_DESKTOP_GRID_GAP,
} from "@/components/setlistLayout";

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

  // Short performer names match the mockup's compact shape — characters
  // like 林田乃理 fit the 180px column at small font sizes only when the
  // shortName cascade kicks in (e.g. "ノリ"). The cascade falls through
  // to the long name when no short variant exists.
  const performers = item.performers.map(
    (p) =>
      displayNameWithFallback(
        p.stageIdentity,
        p.stageIdentity.translations,
        locale,
        "short",
      ) || t("unknownPerformer"),
  );

  const unitArtist =
    item.stageType !== "full_group" && item.artists?.[0]
      ? item.artists[0]
      : null;
  // Full unit name on setlist rows — operator preference. UnitBadge
  // already constrains horizontal width via the row's grid column,
  // so a longer label clips with ellipsis rather than reflowing the
  // row.
  const unitArtistName = unitArtist
    ? displayNameWithFallback(
        unitArtist.artist,
        unitArtist.artist.translations,
        locale,
        "full",
      )
    : "";

  const isNonSong = NON_SONG_TYPES.has(item.type);
  const showReactions = !isNonSong && songNames.length > 0;
  const reactions = showReactions ? (
    <ReactionButtons
      setlistItemId={String(item.id)}
      songId={String(item.songs[0].song.id)}
      eventId={eventId}
      initialCounts={reactionCounts[String(item.id)] ?? EMPTY_COUNTS}
    />
  ) : null;

  return (
    <li
      style={
        {
          borderBottom: `1px solid ${colors.borderLight}`,
          // CSS var carries the desktop grid template into the
          // Tailwind arbitrary-value class below — single source of
          // truth shared with `<SetlistColumnHeader>` (see
          // `setlistLayout.ts`).
          "--setlist-cols": SETLIST_DESKTOP_GRID_COLS,
          "--setlist-gap": `${SETLIST_DESKTOP_GRID_GAP}px`,
          "--row-hover-bg": colors.bgSubtle,
        } as React.CSSProperties
      }
      // Single responsive grid for both viewports — render the
      // reactions ONCE and let CSS relocate them via `grid-column`
      // overrides. Two-render approach (mobile copy + desktop copy)
      // would double-mount the stateful `<ReactionButtons>` and let
      // their optimistic-counts state diverge.
      //
      // Mobile (default): 2-col grid `[34px_1fr]` (position is 22px
      // visual + 12px gap). Title spans col 2 row 1; reactions span
      // col 2 row 2.
      //
      // Desktop (≥ lg): pulls the column template from the shared
      // CSS var so `<SetlistColumnHeader>` and `<SetlistRow>` can't
      // drift. Position col 1, title col 2, performers col 3,
      // reactions col 4 — single row.
      className="grid grid-cols-[34px_1fr] items-start gap-x-3 px-4 py-3 lg:grid-cols-[var(--setlist-cols)] lg:gap-x-[var(--setlist-gap)] lg:px-5 lg:py-2.5 lg:hover:bg-[var(--row-hover-bg)] lg:transition-colors lg:duration-[120ms]"
    >
      {/* Position number — col 1, row 1. */}
      <span
        className="mt-0.5 pt-px text-right text-sm font-mono lg:w-9"
        style={{ color: colors.textMuted }}
      >
        {index + 1}
      </span>

      {/* Title block — col 2, row 1 on both viewports. */}
      <div className="min-w-0">
        <SongTitleBlock
          songNames={songNames}
          itemType={item.type}
          position={item.position}
          eventId={eventId}
          t={t}
        />
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

      {/* Performers — desktop col 3 only. `hidden` on mobile so the
          mobile grid keeps just 2 cols. */}
      <div
        className="hidden text-sm lg:block lg:pt-0.5"
        style={{ color: colors.textSecondary }}
      >
        {performers.length > 0 ? performers.join(", ") : null}
      </div>

      {/* Reactions — mobile spans col 2 row 2 (under the title) so the
          emoji chips sit in their own row below per
          `event-page-mockup.jsx:200`. Desktop pins to col 4 (the
          fixed 260px reactions column). */}
      {reactions && (
        <div className="col-start-2 mt-2 lg:col-start-4 lg:mt-0 lg:pt-0.5">
          {reactions}
        </div>
      )}
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
  // Mockup `event-page-desktop-mockup-v2.jsx:204-212`: bg uses an
  // 8-digit hex with 18 alpha (~9%); text uses the unit color at full
  // opacity. When the operator hasn't backfilled the unit's color yet,
  // fall back to a brand-tinted pill (`primaryBg` / `primary`) instead
  // of zinc gray — matches the active reaction button's visual so the
  // user reads it as "unit pending color" rather than a different
  // category of badge.
  const styled = artistColor
    ? { backgroundColor: `${artistColor}18`, color: artistColor }
    : { backgroundColor: colors.primaryBg, color: colors.primary };
  return (
    <Link
      href={`/${locale}/artists/${artistId}/${artistSlug}`}
      className="mt-1 inline-block rounded px-1.5 py-0.5 text-xs font-medium hover:underline"
      style={styled}
    >
      {label}
    </Link>
  );
}

function FallbackUnitBadge({ label }: { label: string }) {
  return (
    <span
      className="mt-1 inline-block rounded px-1.5 py-0.5 text-xs"
      style={{ background: colors.primaryBg, color: colors.primary }}
    >
      {label}
    </span>
  );
}
