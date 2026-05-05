"use client";

import type { CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { TrendingSongs, type TrendingSong } from "@/components/TrendingSongs";
import { SetlistRow } from "@/components/SetlistRow";
import { deriveTrendingSongs } from "@/lib/trending";
import { deriveSongsCount } from "@/lib/sidebarDerivations";
import { colors, motion, radius, shadows } from "@/styles/tokens";
import {
  SETLIST_DESKTOP_GRID_COLS,
  SETLIST_DESKTOP_GRID_GAP,
} from "@/components/setlistLayout";
// Setlist-shape types live in `src/lib/types/setlist.ts` so pure
// helpers under `src/lib/` can describe them without importing from
// `src/components/`. Re-exported below for back-compat with existing
// import sites that pull `LiveSetlistItem` / `ArtistRef` /
// `StageIdentityRef` from this file.
import type {
  FanTop3Entry,
  LiveSetlistItem,
  ReactionCountsMap,
} from "@/lib/types/setlist";
import { EventWishSection } from "@/components/EventWishSection";

export type {
  ArtistRef,
  StageIdentityRef,
  LiveSetlistItem,
} from "@/lib/types/setlist";

interface Props {
  eventId: string;
  // Polled state — owned by the parent `LiveEventLayout` so a single
  // `useSetlistPolling` call drives both columns. Before the lift,
  // this component owned its own polling subscription via
  // `useSetlistPolling(initialItems, initialReactionCounts, ...)`; now
  // it's a pure render component for the right column and accepts the
  // already-polled values. See `src/components/LiveEventLayout.tsx`.
  items: LiveSetlistItem[];
  reactionCounts: ReactionCountsMap;
  /** Polled fan TOP-3 wishes (Phase 1B). Pre-show + ongoing both update. */
  top3Wishes: FanTop3Entry[];
  initialTrendingSongs: TrendingSong[];
  /**
   * Event start time (UTC). Threaded through to `<EventWishSection>`
   * so the wishlist surface can flip from pre-show → locked at the
   * UTC instant. Same shape as `LiveEventLayout` Props (Date | string).
   */
  startTime: Date | string | null;
  unknownSongLabel: string;
  isOngoing: boolean;
  locale: string;
}

export function LiveSetlist({
  eventId,
  items,
  reactionCounts,
  top3Wishes,
  initialTrendingSongs,
  startTime,
  unknownSongLabel,
  isOngoing,
  locale,
}: Props) {
  const t = useTranslations("Event");
  const ct = useTranslations("Common");

  // While polling, derive trending from the same reactionCounts that drives
  // per-item counts — single source of truth, no risk of the two views
  // drifting. When polling is off (upcoming/completed events) we keep the
  // SSR seed; no recompute, no behavior change.
  const trendingSongs = isOngoing
    ? deriveTrendingSongs(items, reactionCounts, locale, unknownSongLabel)
    : initialTrendingSongs;

  const mainItems = items.filter((item) => !item.isEncore);
  const encoreItems = items.filter((item) => item.isEncore);
  // Items + songs counters for the desktop subtitle. `deriveSongsCount`
  // is the single source of truth shared with the sidebar's "X songs"
  // pill (`EventHeader.songsCount`) — an admin-created placeholder
  // song-typed item with no song picked yet doesn't get counted, so
  // the two surfaces can't drift.
  const itemCount = items.length;
  const songCount = deriveSongsCount(items);

  return (
    <>
      {/* Wishlist (Phase 1B) sits at the very top of the right column,
          above Trending — per `raw/mockups/mockup-wish-predict.jsx`.
          Self-hides when locked + no data; renders structurally on
          SSR so hydration matches before localStorage hydrates the
          my-list. `startTime === null` means we don't have an event
          start anchor, so render nothing rather than guessing. */}
      {startTime !== null && (
        <EventWishSection
          eventId={eventId}
          locale={locale}
          startTime={startTime}
          setlistItems={items}
          top3Wishes={top3Wishes}
        />
      )}
      {/* Trending sits ABOVE the setlist card as its own surface (amber
          tokens), per mockup. Not a child of the white setlist card. */}
      <TrendingSongs songs={trendingSongs} />
    <section
      className="mb-8"
      style={{
        background: colors.bgCard,
        borderRadius: radius.card,
        boxShadow: shadows.card,
        overflow: "hidden",
      }}
    >
      {/* Setlist card header. Desktop shows the count subtitle on the
          right (`21 items · 18 songs`); mobile swaps it for the
          tap-to-add hint. The LIVE pill is appended to the title on
          ongoing events; renders before the right-side meta so the
          right edge stays aligned across breakpoints. */}
      <div
        className="flex items-center justify-between gap-2"
        style={{
          padding: "16px 20px 12px",
          borderBottom: `1px solid ${colors.borderLight}`,
        }}
      >
        <div className="flex items-center gap-2">
          <h2
            // `text-transform: uppercase` is locale-safe — CJK
            // characters pass through unchanged ("セットリスト",
            // "세트리스트" stay as-is); only Latin-script
            // ("Setlist" → "SETLIST") gets the all-caps treatment
            // per the operator's preference for English headers.
            style={{
              fontSize: 15,
              fontWeight: 700,
              color: colors.textPrimary,
              letterSpacing: "0.02em",
              textTransform: "uppercase",
              margin: 0,
            }}
          >
            {t("setlist")}
          </h2>
          {isOngoing && (
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
              style={{
                background: colors.liveBg,
                color: colors.live,
              }}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{
                  background: colors.live,
                  animation: motion.livePulse,
                }}
              />
              {t("live")}
            </span>
          )}
        </div>
        {/* Right-side meta: desktop count subtitle. */}
        <span
          className="hidden lg:inline"
          style={{ fontSize: 12, color: colors.textMuted }}
        >
          {t("itemsLabel", { count: itemCount })} ·{" "}
          {t("songsValue", { count: songCount })}
        </span>
        {/* Right-side meta: mobile tap hint. */}
        <span
          className="lg:hidden"
          style={{ fontSize: 11, color: colors.textMuted }}
        >
          {t("tapToAddReaction")}
        </span>
      </div>

      {items.length === 0 ? (
        <p style={{ padding: "24px 20px", color: colors.textMuted }}>
          {t("noSetlist")}
        </p>
      ) : (
        <>
          {/* Desktop column-header strip — same 4-col grid as data rows. */}
          <SetlistColumnHeader
            labels={{
              position: t("colPosition"),
              song: t("colSong"),
              performers: t("colPerformers"),
              reactions: t("colReactions"),
            }}
          />
          <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {mainItems.map((item, index) => (
              <SetlistRow
                key={item.id}
                item={item}
                index={index}
                reactionCounts={reactionCounts}
                locale={locale}
                eventId={eventId}
              />
            ))}
          </ol>
          {encoreItems.length > 0 && (
            <>
              <EncoreDivider label={ct("encore")} />
              <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {encoreItems.map((item, index) => (
                  <SetlistRow
                    key={item.id}
                    item={item}
                    index={index}
                    reactionCounts={reactionCounts}
                    locale={locale}
                    eventId={eventId}
                  />
                ))}
              </ol>
            </>
          )}
        </>
      )}
    </section>
    </>
  );
}

// Desktop column-name row — `# / SONG / PERFORMERS / REACTIONS`.
// Pulls `SETLIST_DESKTOP_GRID_COLS` so every label sits directly
// above its data column on the row below; the constant is the only
// source of truth for the four-column template. Mobile hides via
// `hidden lg:grid` since mobile rows are stacked, not gridded.
function SetlistColumnHeader({
  labels,
}: {
  labels: {
    position: string;
    song: string;
    performers: string;
    reactions: string;
  };
}) {
  const headerStyle: CSSProperties = {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
  };
  return (
    <div
      aria-hidden="true"
      className="hidden lg:grid"
      style={{
        // Single source of truth for the column template + gap so
        // header and body can't drift. See `setlistLayout.ts`.
        gridTemplateColumns: SETLIST_DESKTOP_GRID_COLS,
        columnGap: SETLIST_DESKTOP_GRID_GAP,
        padding: "8px 20px",
        background: colors.bgFaint,
        borderBottom: `2px solid ${colors.border}`,
      }}
    >
      <span style={headerStyle}>{labels.position}</span>
      <span style={headerStyle}>{labels.song}</span>
      <span style={headerStyle}>{labels.performers}</span>
      <span style={headerStyle}>{labels.reactions}</span>
    </div>
  );
}

// Encore divider — Common.encore key with CSS uppercase + tracking. No new
// i18n key needed (handoff §6 visual uses ALL-CAPS but the underlying label
// text stays locale-driven).
function EncoreDivider({ label }: { label: string }) {
  return (
    <div className="my-4 flex items-center gap-3">
      <div className="h-px flex-1 bg-zinc-200" />
      <span className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
        {label}
      </span>
      <div className="h-px flex-1 bg-zinc-200" />
    </div>
  );
}
