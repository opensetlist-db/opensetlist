"use client";

import { useTranslations } from "next-intl";
import { TrendingSongs, type TrendingSong } from "@/components/TrendingSongs";
import { SetlistRow } from "@/components/SetlistRow";
import {
  useSetlistPolling,
  type ReactionCountsMap,
} from "@/hooks/useSetlistPolling";
import { deriveTrendingSongs } from "@/lib/trending";
import { colors, motion, radius, shadows } from "@/styles/tokens";
import {
  SETLIST_DESKTOP_GRID_COLS,
  SETLIST_DESKTOP_GRID_GAP,
} from "@/components/setlistLayout";

type NameTranslation = {
  locale: string;
  name: string;
  shortName?: string | null;
};

type SongTranslation = {
  locale: string;
  title: string;
  variantLabel?: string | null;
};

type ArtistRef = {
  id: number;
  slug: string;
  parentArtistId?: number | null;
  color: string | null;
  originalName: string | null;
  originalShortName: string | null;
  originalLanguage: string;
  translations: NameTranslation[];
};

type StageIdentityRef = {
  id: string;
  originalName: string | null;
  originalShortName: string | null;
  originalLanguage: string;
  translations: NameTranslation[];
};

type RealPersonRef = {
  id: string;
  originalName: string | null;
  originalStageName: string | null;
  originalLanguage: string;
  translations: NameTranslation[];
};

type SongRef = {
  id: number;
  slug: string;
  originalTitle: string;
  originalLanguage: string;
  variantLabel: string | null;
  translations: SongTranslation[];
  artists: Array<{ artist: ArtistRef }>;
};

export type LiveSetlistItem = {
  id: number;
  position: number;
  isEncore: boolean;
  stageType: string;
  unitName: string | null;
  status: string;
  performanceType: string | null;
  type: string;
  songs: Array<{ song: SongRef }>;
  performers: Array<{
    stageIdentity: StageIdentityRef;
    realPerson: RealPersonRef | null;
  }>;
  artists: Array<{ artist: ArtistRef }>;
};

interface Props {
  eventId: string;
  initialItems: LiveSetlistItem[];
  initialReactionCounts: ReactionCountsMap;
  initialTrendingSongs: TrendingSong[];
  unknownSongLabel: string;
  isOngoing: boolean;
  locale: string;
}

export function LiveSetlist({
  eventId,
  initialItems,
  initialReactionCounts,
  initialTrendingSongs,
  unknownSongLabel,
  isOngoing,
  locale,
}: Props) {
  const t = useTranslations("Event");
  const ct = useTranslations("Common");

  const { items, reactionCounts } = useSetlistPolling<LiveSetlistItem>({
    eventId,
    initialItems,
    initialReactionCounts,
    enabled: isOngoing,
  });

  // While polling, derive trending from the same reactionCounts that drives
  // per-item counts — single source of truth, no risk of the two views
  // drifting. When polling is off (upcoming/completed events) we keep the
  // SSR seed; no recompute, no behavior change.
  const trendingSongs = isOngoing
    ? deriveTrendingSongs(items, reactionCounts, locale, unknownSongLabel)
    : initialTrendingSongs;

  const mainItems = items.filter((item) => !item.isEncore);
  const encoreItems = items.filter((item) => item.isEncore);
  // Items + songs counters for the desktop subtitle. Songs filter
  // matches the page-level `songsCount` (passed to `EventHeader`)
  // exactly: `type === "song"` AND a song row attached. An
  // admin-created placeholder song-typed item with no song picked
  // yet doesn't get counted — keeps the sidebar's "X songs" pill
  // and this subtitle in sync.
  const itemCount = items.length;
  const songCount = items.filter(
    (i) => i.type === "song" && i.songs.length > 0,
  ).length;

  return (
    <>
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

// Desktop column-name row — `# / SONG / PERFORMERS / REACTIONS`. Same
// `36px 1fr 180px 260px` grid as `<SetlistRow>`'s desktop body so
// every label sits directly above its column. Mobile hides via
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
  const headerStyle: React.CSSProperties = {
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
