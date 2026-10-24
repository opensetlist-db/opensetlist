"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  displayNameWithFallback,
  displayOriginalTitle,
} from "@/lib/display";
import { trackEvent } from "@/lib/analytics";
import { ReactionButtons } from "@/components/ReactionButtons";
import { RowContestButton } from "@/components/RowContestButton";
import { IssueReportButton } from "@/components/IssueReportButton";
import {
  NumberSlot,
  type RowState,
  type RowVote,
} from "@/components/NumberSlot";
import type { LiveSetlistItem } from "@/components/LiveSetlist";
import type { ReactionCountsMap } from "@/hooks/useSetlistPolling";
import { colors } from "@/styles/tokens";
import { resolveUnitColor } from "@/lib/artistColor";
import {
  groupBadgeLabel,
  MAX_ROW_BADGES,
  pickRowArtistBadges,
} from "@/lib/setlistRowBadge";
import styles from "@/components/event/eventDetail.module.css";
import { entityPath } from "@/lib/seo/entityUrl";

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
  /**
   * `capturedAt` of the live snapshot `reactionCounts` came from —
   * forwarded to `<ReactionButtons>` for the reaction ack hold.
   * Optional; omitted → pre-n14 behaviour (no hold).
   */
  snapshotCapturedAt?: string | null;
  locale: string;
  eventId: string;
  /**
   * The event's primary artist id (stringified BigInt), `null` when
   * the event has none, or `undefined` when the caller has no event
   * context. Decides whether `full_group` rows get a group badge —
   * see `pickRowArtistBadges` for the rule. Multi-group events (LL
   * 15th Fes under the `lovelive-series` umbrella) badge every row;
   * single-artist events keep badges on unit/solo/special rows only.
   */
  eventArtistId?: string | null;
  /**
   * Binary row state — defaults to `"confirmed"` so existing
   * non-Confirm-UI callers (admin SetlistBuilder etc.) see
   * byte-identical render. Drives the gray-bg / no-bg distinction
   * on the row body. The 3-state shape from v0.10.0
   * (`my-confirmed` as a separate state) collapsed to 2-state in
   * v0.10.1 once the cell became two independent vote buttons —
   * the viewer's vote is now a separate axis carried by `myVote`.
   */
  rowState?: RowState;
  /**
   * Per-viewer vote on this rumoured row, composed by
   * `<ActualSetlist>` from `useLocalConfirm` + `useLocalDisagree`.
   * Defaults to "none". Ignored when `rowState === "confirmed"`.
   */
  myVote?: RowVote;
  /**
   * Tap handler for the ✓ button. Wired by `<ActualSetlist>` to
   * `useLocalConfirm`'s toggle (with mutual-exclusivity coordination
   * against `useLocalDisagree`).
   */
  onConfirmTap?: () => void;
  /**
   * Tap handler for the ✕ button. Wired by `<ActualSetlist>` to
   * `useLocalDisagree`'s toggle (with mutual-exclusivity coordination
   * against `useLocalConfirm`).
   */
  onDisagreeTap?: () => void;
  /**
   * Conflict-group siblings — the OTHER rumoured rows at the same
   * `(eventId, position)`. Non-empty when this row is in a conflict
   * group; undefined (or empty) for non-contested rows. Drives
   * visibility of `<RowContestButton>` and is the basis for the
   * parent's `getConfirmStatus(item, siblings)` 1-min-suspension
   * call (`<ActualSetlist>` precomputes `rowState` with siblings
   * context so this component stays purely presentational).
   *
   * Reserved affordance slot in this row will accept the follow-up
   * "ContestReport" PR's "이슈 제기" button for any-status rows
   * (missing performer / wrong variant / etc.) — the slot pattern
   * is the integration point.
   */
  siblings?: ReadonlyArray<{ id: number }>;
  /**
   * Callback fired when the per-row contest affordance is tapped.
   * `<ActualSetlist>` lifts this up to drive the AddItemBottomSheet
   * open + presetPosition state. Optional so callers that don't
   * support contest (admin SetlistBuilder etc.) omit the handler.
   */
  onContest?: (position: number) => void;
  /**
   * Whether the issue-report affordance (the slower, queue-based
   * "이슈 제기" button) should be rendered on this row. Driven by
   * `LAUNCH_FLAGS.contestReportEnabled` at the parent level. When
   * true AND `onIssueReport` is provided, the button surfaces on
   * EVERY row (rumoured + confirmed), distinct from the
   * conflict-only `<RowContestButton>` above.
   */
  canReport?: boolean;
  /**
   * Callback fired when the issue-report affordance is tapped.
   * `<ActualSetlist>` lifts this up to drive ContestReportSheet's
   * open + setlistItemId state. Optional for callers that don't
   * support reporting (admin SetlistBuilder etc.).
   */
  onIssueReport?: (setlistItemId: number) => void;
}

export function SetlistRow({
  item,
  index,
  reactionCounts,
  snapshotCapturedAt,
  locale,
  eventId,
  eventArtistId,
  rowState = "confirmed",
  myVote = "none",
  onConfirmTap,
  onDisagreeTap,
  siblings,
  onContest,
  canReport,
  onIssueReport,
}: Props) {
  // Conflict-group affordance is gated on three conditions, all
  // required: row is rumoured (no real-time sibling contest on
  // confirmed rows — use the ContestReport queue path for those),
  // has siblings (no contest on a single rumoured row — the footer
  // "+ 곡 추가" covers next-position intent), and the parent
  // provided a contest handler (admin contexts omit it).
  const showContest =
    rowState !== "confirmed" &&
    siblings !== undefined &&
    siblings.length > 0 &&
    onContest !== undefined;
  // Issue-report affordance — visible on EVERY row (rumoured AND
  // confirmed) when the launch flag is on and the parent provided
  // a handler. Distinct from the real-time sibling path above.
  const showIssueReport = canReport === true && onIssueReport !== undefined;
  const t = useTranslations("Event");
  const confirmT = useTranslations("Confirm");
  const setlistT = useTranslations("Setlist");

  const songNames = item.songs.map((s) => {
    const { main, sub, variant } = displayOriginalTitle(
      s.song,
      s.song.translations,
      locale,
    );
    // Schema declares `Song.slug` as required + unique, but some
    // pre-redesign imports left it blank; `entityPath` drops the slug
    // segment for an empty slug, and the `[[...slug]]` catch-all
    // resolves on id alone.
    return {
      id: s.song.id,
      href: entityPath("songs", locale, s.song.id, s.song.slug),
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

  // Honor the row's first SetlistItemArtist as a "unit credit" for
  // any non-`full_group` stage type, EXCEPT when the credit is a
  // solo-type Artist on a non-solo stage type — that combination is
  // the F18 misfire: an ad-hoc unit-stage row where the operator
  // credited one performing member's solo Artist row (e.g. event 43,
  // "Love it!" / "Wonderful Trip!") rendered that single solo
  // Artist's name as a `<UnitBadge>`, tinted by `resolveUnitColor`'s
  // slug-hashed palette fallback (because solo `Artist.color` is
  // null) — visible as "one performer name with a mystery color"
  // under the title.
  //
  // The suppression is intentionally narrow — limited to the
  // demonstrated misfire. All other type combinations (unit-type or
  // group-type Artist on unit/special rows; solo-type on solo rows)
  // continue to render `<UnitBadge>` exactly as before.
  //
  // F18 rows fall through to the existing `<FallbackUnitBadge
  // label={t("stageType.unit")}>` branch below (line ~188), matching
  // PR #190 D4b: never expose half-formed unit data publicly. The
  // desktop col-3 list (`item.performers.join(", ")`) continues to
  // show the full lineup unchanged.
  //
  // On multi-group events (LL Fes) the same helper also badges
  // `full_group` rows whose credit differs from the event's primary
  // artist — see `pickRowArtistBadges` for the full rule table.
  //
  // Multi-credit rows (a genuine multi-group collab) get up to
  // MAX_ROW_BADGES chips in credit order, then a `+N` chip whose
  // title lists the rest.
  const badgeArtists = pickRowArtistBadges(item, eventArtistId);
  // Full unit name on setlist rows — operator preference. UnitBadge
  // already constrains horizontal width via the row's grid column,
  // so a longer label clips with ellipsis rather than reflowing the
  // row. Group-type credits (the festival case: 「Aqours」「虹ヶ咲」
  // 「蓮ノ空」) use the SHORT form instead — group full names
  // ("虹ヶ咲学園スクールアイドル同好会") would eat the whole badge
  // and the short form is how fans name them anyway. `groupBadgeLabel`
  // prefers `originalShortName` over a long localized name (see its
  // doc for why the generic short cascade isn't enough).
  //
  // Credits with no resolvable name are dropped from the chip list;
  // if that leaves nothing, the row shows the stageType fallback.
  const namedBadges = badgeArtists
    .map((artist) => ({
      artist,
      label:
        artist.type === "group"
          ? groupBadgeLabel(artist, locale)
          : displayNameWithFallback(
              artist,
              artist.translations,
              locale,
              "full",
            ),
    }))
    .filter((b) => b.label);
  const shownBadges = namedBadges.slice(0, MAX_ROW_BADGES);
  const hiddenBadges = namedBadges.slice(MAX_ROW_BADGES);

  const isNonSong = NON_SONG_TYPES.has(item.type);
  // "Unknown song" row: a song-typed item with no `SetlistItemSong`
  // yet. The operator saved it to hold the slot + order while the
  // title is being identified (festival night: not every song is
  // recognised in real time); filling in the song later turns it into
  // a normal row at the same position. Publicly it renders a
  // "song TBC" label, never the operator's `note` (unlocalised
  // operator text — same reasoning as the `unitName` suppression
  // below), and exposes no ✓/✕ vote (nothing to confirm yet) and no
  // reactions (no songId to attach them to).
  const isUnknownSong = item.type === "song" && songNames.length === 0;
  const showReactions = !isNonSong && songNames.length > 0;
  const reactions = showReactions ? (
    <ReactionButtons
      setlistItemId={String(item.id)}
      songId={String(item.songs[0].song.id)}
      eventId={eventId}
      initialCounts={reactionCounts[String(item.id)] ?? EMPTY_COUNTS}
      snapshotCapturedAt={snapshotCapturedAt}
    />
  ) : null;

  // `rowState !== "confirmed"` paints the row gray to communicate
  // "not yet verified" at a glance (rumoured) or "you confirmed
  // this" (my-confirmed). Reuses `colors.bgSubtle` rather than a
  // new token — one hex off from the mockup's `#f8f9fa`,
  // visually indistinguishable. Stage B foundation; full lifecycle
  // (localStorage read + write + tap handler) ships in Stage C.
  const isUnverified = rowState !== "confirmed";
  const creditsT = useTranslations("EventDetail");
  const hasCreditLine =
    !isNonSong &&
    (namedBadges.length > 0 ||
      badgeArtists.length > 0 ||
      item.stageType !== "full_group");
  // The per-song performer names live behind a toggle (below). A row
  // with nobody credited gets no toggle at all — an empty disclosure
  // would promise content that isn't there.
  const hasPerformerCredits = !isNonSong && performers.length > 0;
  return (
    // 18-v3 `.song-row`: each row is its own small card — number chip,
    // then the body (title, unit credit chips, the performer credits
    // disclosure, reactions). From 1100px the body becomes a two-column
    // grid and the reactions sit at the right of the title; below that
    // they wrap under the credits. The reactions render ONCE and CSS
    // moves them: a second copy would double-mount the stateful
    // <ReactionButtons> and let their optimistic counts diverge.
    //
    // Rumoured rows keep the gray background (inline, so the unverified
    // state reads at a glance on top of the white card) and their
    // vertical ✓/✕ pair in the number column.
    <li
      className={styles.songRow}
      style={isUnverified ? { background: colors.bgSubtle } : undefined}
    >
      {/* Position slot: plain number chip for confirmed rows, the ✓/✕
          vote pair for rumoured ones (v0.10.1 dual-button cell; the
          mailto FlagButton it replaced is gone). */}
      <NumberSlot
        state={isUnknownSong ? "confirmed" : rowState}
        position={index + 1}
        myVote={myVote}
        onConfirmTap={onConfirmTap}
        onDisagreeTap={onDisagreeTap}
        confirmAriaLabel={confirmT("confirmAria")}
        disagreeAriaLabel={confirmT("disagreeAria")}
      />

      <div className={styles.songBody}>
        <SongTitleBlock
          songNames={songNames}
          itemType={item.type}
          position={item.position}
          eventId={eventId}
          t={t}
          unknownSongLabel={setlistT("unknownSong")}
        />
        {hasCreditLine && (
          <CreditHeading
            performers={hasPerformerCredits ? performers : null}
            panelTitle={creditsT("songPerformers")}
          >
            <div className={styles.creditLine}>
              {shownBadges.map(({ artist, label }) => (
                <UnitBadge
                  key={artist.id}
                  artistColor={artist.color}
                  locale={locale}
                  artistId={artist.id}
                  artistSlug={artist.slug}
                  label={label}
                />
              ))}
              {hiddenBadges.length > 0 && (
                <span
                  className={styles.artistTag}
                  style={{ "--artist": colors.border } as React.CSSProperties}
                  title={hiddenBadges.map((b) => b.label).join(", ")}
                >
                  +{hiddenBadges.length}
                </span>
              )}
              {/* Backed unit credited but no resolvable name (rare —
                  Artist with empty translations + null originalName).
                  Falls back to the i18n stageType label so the row still
                  reads as "this is a unit-stage performance". */}
              {badgeArtists.length > 0 && namedBadges.length === 0 && (
                <FallbackUnitBadge
                  label={t(
                    `stageType.${item.stageType}` as Parameters<typeof t>[0],
                  )}
                />
              )}
              {/* No backed unit at all (ad-hoc one-time unit OR operator
                  hasn't filled the credit yet). Per Phase 1A decision D4b,
                  the operator-typed `item.unitName` is intentionally
                  suppressed on public surfaces — the field has no
                  translations and rendering one locale's text to viewers
                  in another locale was the original gap. Show the generic
                  stageType label instead. */}
              {badgeArtists.length === 0 && item.stageType !== "full_group" && (
                <FallbackUnitBadge
                  label={t(
                    `stageType.${item.stageType}` as Parameters<typeof t>[0],
                  )}
                />
              )}
            </div>
          </CreditHeading>
        )}

        {/* Chip-less rows (a `full_group` row on a single-artist event,
            where the chip is deliberately suppressed) have no chip line
            for the toggle to sit beside, so they keep the 18-v3
            "출연 크레딧" disclosure — exactly what the approved v3 browser
            mockup left on those rows. */}
        {!hasCreditLine && hasPerformerCredits && (
          <details className={styles.creditDetails}>
            <summary>{creditsT("creditsToggle")}</summary>
            <p>{performers.join(", ")}</p>
          </details>
        )}

        {/* Affordance slot — per-row action area. Holds up to two
            buttons today:
              1. `<RowContestButton>` (conflict handling): only on
                 rumoured rows in a conflict group. Opens
                 AddItemBottomSheet pre-targeted at this position.
              2. `<IssueReportButton>`: on EVERY row when
                 `canReport && onIssueReport` are set. Opens
                 ContestReportSheet (queued operator triage).
            Distinct intents; both can show on a rumoured-in-conflict
            row. */}
        {(showContest || showIssueReport) && (
          <div className="mt-1 flex flex-wrap items-center gap-x-2">
            {showContest && (
              <RowContestButton
                position={item.position}
                onContest={onContest!}
              />
            )}
            {showIssueReport && (
              <IssueReportButton
                setlistItemId={item.id}
                onReport={onIssueReport!}
              />
            )}
          </div>
        )}

        {reactions && <div className={styles.songReactions}>{reactions}</div>}
      </div>
    </li>
  );
}

/*
 * Credit line + per-song performer toggle (consistency-03-v3 §7.3).
 *
 * The 18-v3 row had a separate "출연 크레딧" <details> line under the
 * unit chips; v3 folds it into the chip line: a 28×28 chevron button
 * sits right after the existing performance-artist / unit chips and
 * opens a small panel titled "이 곡의 출연 멤버" with the row's
 * StageIdentity short names — the same list the old disclosure held.
 * Nothing new is inferred: no original singer, no real-person name, no
 * event headliner standing in for a missing chip.
 *
 * Only rows with a chip line get it; chip-less rows keep their 18-v3
 * <details> (see the call site). Rows with chips but no performers get
 * the chips alone.
 *
 * A real <button> with aria-expanded / aria-controls instead of
 * <details>: the chevron lives inside a flex line with the chips, and
 * the panel opens below the whole line, which a <summary> (the first
 * child of its own box) cannot do without moving the chips into it.
 */
function CreditHeading({
  performers,
  panelTitle,
  children,
}: {
  performers: string[] | null;
  panelTitle: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <>
      <div className={styles.creditHeading}>
        {children}
        {performers && (
          <button
            type="button"
            className={styles.creditToggle}
            aria-label={panelTitle}
            title={panelTitle}
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((v) => !v)}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
        )}
      </div>
      {performers && (
        <div id={panelId} className={styles.creditBody} hidden={!open}>
          <strong>{panelTitle}</strong>
          <p>{performers.join(", ")}</p>
        </div>
      )}
    </>
  );
}

function SongTitleBlock({
  songNames,
  itemType,
  position,
  eventId,
  t,
  unknownSongLabel,
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
  unknownSongLabel: string;
}) {
  if (songNames.length === 0) {
    return (
      <div className={styles.songTitle}>
        <span className={styles.nonSongLabel} style={{ color: colors.textMuted }}>
          {itemType !== "song"
            ? t(`itemType.${itemType}` as Parameters<typeof t>[0])
            : unknownSongLabel}
        </span>
      </div>
    );
  }

  // Medley songs are joined with "/" in the approved card row (18-v3:
  // "No brand girls / START:DASH!! / …"); each title keeps its own link.
  return (
    <div className={styles.songTitle}>
      {songNames.map((song, i) => (
        <span key={song.id}>
          {i > 0 && <span className={styles.medleyJoin}>/</span>}
          <Link
            href={song.href}
            onClick={() =>
              trackEvent("setlist_item_click", {
                song_id: String(song.id),
                event_id: eventId,
                position,
              })
            }
          >
            {song.main}
          </Link>
          {song.sub && <span className={styles.songSub}> {song.sub}</span>}
          {song.variantLabel && (
            <span className={styles.songSub}> ({song.variantLabel})</span>
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
  // 18-v3 `.artist-tag`: the unit colour washes the chip
  // (`color-mix(--artist 32%, white)`) and the label stays ink, so an
  // unverified pastel never carries text. When the operator hasn't
  // backfilled `Artist.color`, `resolveUnitColor` substitutes a
  // deterministic palette pick keyed on the slug — colour-pending units
  // in one setlist stay distinguishable, and match the artist page.
  const resolved = resolveUnitColor({
    slug: artistSlug,
    color: artistColor,
  });
  return (
    <Link
      href={entityPath("artists", locale, artistId, artistSlug)}
      className={styles.artistTag}
      style={{ "--artist": resolved } as React.CSSProperties}
    >
      {label}
    </Link>
  );
}

function FallbackUnitBadge({ label }: { label: string }) {
  return (
    <span
      className={styles.artistTag}
      style={{ "--artist": colors.primaryBorder } as React.CSSProperties}
    >
      {label}
    </span>
  );
}
