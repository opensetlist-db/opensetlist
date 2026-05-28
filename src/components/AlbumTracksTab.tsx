import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { colors, radius } from "@/styles/tokens";
import {
  getAlbumTrackTitle,
  type EnrichedAlbumTrack,
} from "@/lib/albumTrackTitle";
import { displayOriginalTitle } from "@/lib/display";

/*
 * Tracks tab content for the Album detail page (b04). Renders the
 * album's AlbumTrack rows disc-grouped, with the b01b dispatch
 * deciding what to show per row:
 *
 *   Pattern 1 (vocal):  vocal Song name + clickable link to the
 *                       Song page (the only setlist-eligible row
 *                       type, so the only link target that makes
 *                       sense)
 *   Pattern 2 (off-vocal w/ vocal parent):
 *                       "{parent title} ({off-vocal suffix})" —
 *                       no link (off-vocal version doesn't have
 *                       its own Song page entry)
 *   Pattern 3 (drama/bgm direct title):
 *                       AlbumTrack.title (or Pattern 3 Translation)
 *                       — no link (no Song row exists)
 *
 * getAlbumTrackTitle handles the full pattern dispatch + i18n
 * variantSuffix lookup; this component just decides clickable vs
 * plain-text per row and does the disc grouping on top.
 *
 * Hidden on live_album type per b02's TabBar visibility — that's
 * the page.tsx caller's responsibility; this component itself
 * doesn't need to know about album type.
 */

interface Props {
  tracks: EnrichedAlbumTrack[];
  locale: string;
}

export async function AlbumTracksTab({ tracks, locale }: Props) {
  const tNs = await getTranslations({ locale, namespace: "Album.tracks" });
  // Root translator passed to getAlbumTrackTitle — that helper
  // composes full key paths ("AlbumTrack.variantSuffix.<variant>",
  // "AlbumTrack.fallbackTrack") so it needs the root, not a
  // namespace-scoped, t function.
  const tRoot = await getTranslations({ locale });

  if (tracks.length === 0) {
    return (
      <div
        style={{
          background: colors.bgCard,
          borderRadius: radius.card,
          padding: "32px 20px",
          textAlign: "center",
          color: colors.textMuted,
          fontSize: 14,
          // Width 100% — same edge as the other tabs' placeholders.
          width: "100%",
        }}
      >
        {tNs("empty")}
      </div>
    );
  }

  // Disc-group the tracks. The fetch already orders
  // [discNumber asc, trackNumber asc] (page.tsx getAlbum include),
  // so a simple per-disc bucketing preserves track ordering inside
  // each group without an extra sort here.
  const groupedByDisc = new Map<number, EnrichedAlbumTrack[]>();
  for (const track of tracks) {
    const disc = track.discNumber;
    const bucket = groupedByDisc.get(disc) ?? [];
    bucket.push(track);
    groupedByDisc.set(disc, bucket);
  }
  const sortedDiscs = Array.from(groupedByDisc.entries()).sort(
    (a, b) => a[0] - b[0],
  );
  // Single-disc albums skip the "DISC 1" header — for the common
  // single-/EP-/single-CD-album case the disc label adds no info,
  // just visual noise. Multi-disc releases (live BD Memorial BOX,
  // anniversary collections) keep the header so the boundary between
  // Disc 1 and Disc 2 is visible. Operator feedback during mockup-
  // gap audit.
  const showDiscHeaders = sortedDiscs.length > 1;

  return (
    // Single outer big box, mirroring the events tab's
    // <PerformanceGroup> wrapper shape (one bgCard + overflow:hidden
    // shell wrapping all child rows). Earlier shape was an outer
    // flex column with each disc section carrying its own bgCard /
    // borderRadius / padding — operator caught that this read as
    // a narrower content area than the events tab's single-box
    // shell, even though section widths matched. Re-using the same
    // single-shell pattern unifies the visual edge.
    <div
      style={{
        background: colors.bgCard,
        borderRadius: radius.card,
        overflow: "hidden",
        width: "100%",
      }}
    >
      {sortedDiscs.map(([discNumber, discTracks], discIdx) => (
        <div
          key={discNumber}
          style={{
            // Top border separator between discs (multi-disc case
            // only). The first disc sits flush against the box
            // top; subsequent discs get a hairline rule above the
            // header, matching the visual rhythm of
            // PerformanceGroup's inter-section separator.
            borderTop:
              discIdx > 0
                ? `1px solid ${colors.borderLight}`
                : undefined,
          }}
        >
          {showDiscHeaders ? (
            <h3
              style={{
                margin: 0,
                padding: "12px 16px 8px",
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: colors.textSubtle,
              }}
            >
              {tNs("discN", { disc: discNumber })}
            </h3>
          ) : null}
          <ol
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "flex",
              flexDirection: "column",
            }}
          >
            {discTracks.map((track) => {
              // Pattern 1 (vocal Song-backed) defers entirely to
              // displayOriginalTitle — same shared utility the song
              // detail page uses for its H1 + subtitle, so the
              // main/sub split is consistent across surfaces:
              //   main = song.originalTitle (original-language)
              //   sub  = locale translation (only when it exists
              //          and differs from the original)
              // The previous shape derived main via getAlbumTrackTitle
              // (which already returns the locale translation) and
              // sub via displayOriginalTitle.sub (also the locale
              // translation) — both fields ended up holding the same
              // translated string. Routing Pattern 1 through the
              // shared utility removes the duplication.
              //
              // Pattern 2/3 (off-vocal w/ vocal parent, drama/bgm
              // direct title) have no vocal Song to anchor on, so
              // getAlbumTrackTitle's composed form (variant suffix
              // appended / direct title resolved) is the single-line
              // value; no sub treatment is appropriate.
              const titleParts = track.song
                ? displayOriginalTitle(
                    track.song,
                    track.song.translations ?? [],
                    locale,
                  )
                : {
                    main: getAlbumTrackTitle(track, locale, tRoot),
                    sub: null,
                  };
              return (
                <TrackRow
                  key={track.id}
                  track={track}
                  locale={locale}
                  title={titleParts.main}
                  titleSub={titleParts.sub}
                  trackNumberLabel={tNs("trackPrefix", {
                    track: track.trackNumber,
                  })}
                />
              );
            })}
          </ol>
        </div>
      ))}
    </div>
  );
}

function TrackRow({
  track,
  locale,
  title,
  titleSub,
  trackNumberLabel,
}: {
  track: EnrichedAlbumTrack;
  locale: string;
  title: string;
  titleSub: string | null;
  trackNumberLabel: string;
}) {
  // Pattern 1: vocal Song-backed — entire row anchors to the
  // Song detail page. Pattern 2 (parentSong set) intentionally
  // does NOT link — the off-vocal row is informational; the Song
  // page exists for the vocal sibling which is its own
  // Pattern 1 row in the same tracklist.
  const linkHref = track.song
    ? `/${locale}/songs/${track.song.id}/${track.song.slug}`
    : null;

  const numberCell = (
    <span
      style={{
        flexShrink: 0,
        width: 36,
        fontVariantNumeric: "tabular-nums",
        fontSize: 13,
        color: colors.textMuted,
        fontWeight: 600,
        // Pin to the top of a wrapped title cell so the number aligns
        // with the original-title line, not the locale-sub line.
        alignSelf: "flex-start",
        paddingTop: 1,
      }}
    >
      {trackNumberLabel}
    </span>
  );
  // Linkable rows (Pattern 1 — vocal Song-backed) render the title
  // in the brand-primary blue as an affordance cue: it's a click
  // target. Pattern 2 (off-vocal w/ vocal parent) + Pattern 3
  // (drama/bgm direct title) stay in the standard textPrimary —
  // they're informational and have no link target. Operator
  // feedback during mockup-gap audit.
  //
  // `titleSub` carries the locale translation when the Pattern 1
  // song has one that differs from the original (the song-page H1
  // sub line uses the same `displayOriginalTitle` rule). Pattern
  // 2/3 rows never carry a sub line — `getAlbumTrackTitle` already
  // composes the variant suffix into the main title there.
  const titleCell = (
    <span
      style={{
        flex: 1,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        gap: 1,
      }}
    >
      <span
        style={{
          fontSize: 14,
          color: linkHref ? colors.primary : colors.textPrimary,
          wordBreak: "break-word",
        }}
      >
        {title}
      </span>
      {titleSub ? (
        <span
          style={{
            fontSize: 12,
            color: colors.textMuted,
            wordBreak: "break-word",
          }}
        >
          {titleSub}
        </span>
      ) : null}
    </span>
  );

  if (linkHref) {
    return (
      <li>
        <Link
          href={linkHref}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            // Horizontal padding 16px lives on the row now that the
            // disc section no longer carries its own. Matches the
            // events tab's PerformanceGroup row padding so all three
            // tabs' rows hit the same content inset from the outer
            // big-box edge.
            padding: "8px 16px",
            borderBottom: `1px solid ${colors.borderLight}`,
            color: "inherit",
            textDecoration: "none",
          }}
        >
          {numberCell}
          {titleCell}
          <span
            aria-hidden="true"
            style={{
              flexShrink: 0,
              color: colors.textMuted,
              fontSize: 12,
            }}
          >
            ›
          </span>
        </Link>
      </li>
    );
  }
  return (
    <li
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        // Same horizontal padding as the linkable variant above.
        padding: "8px 16px",
        borderBottom: `1px solid ${colors.borderLight}`,
      }}
    >
      {numberCell}
      {titleCell}
    </li>
  );
}
