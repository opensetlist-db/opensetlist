"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  displayNameWithFallback,
  displayOriginalTitle,
} from "@/lib/display";
import { trackEvent } from "@/lib/analytics";
import { ReactionButtons } from "@/components/ReactionButtons";
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
}

export function SetlistRow({
  item,
  index,
  reactionCounts,
  locale,
  eventId,
  rowState = "confirmed",
  myVote = "none",
  onConfirmTap,
  onDisagreeTap,
}: Props) {
  const t = useTranslations("Event");
  const confirmT = useTranslations("Confirm");

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
  const firstArtist = item.artists?.[0] ?? null;
  const isSoloArtistMisfire =
    firstArtist?.artist.type === "solo" && item.stageType !== "solo";
  const unitArtist =
    item.stageType !== "full_group" && firstArtist && !isSoloArtistMisfire
      ? firstArtist
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

  // `rowState !== "confirmed"` paints the row gray to communicate
  // "not yet verified" at a glance (rumoured) or "you confirmed
  // this" (my-confirmed). Reuses `colors.bgSubtle` rather than a
  // new token — one hex off from the mockup's `#f8f9fa`,
  // visually indistinguishable. Stage B foundation; full lifecycle
  // (localStorage read + write + tap handler) ships in Stage C.
  const isUnverified = rowState !== "confirmed";
  return (
    <li
      style={
        {
          borderBottom: `1px solid ${colors.borderLight}`,
          background: isUnverified ? colors.bgSubtle : undefined,
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
      // Mobile (default): 2-col grid `[52px_1fr]` (position cell sized
      // to fit the ✓+✕ dual-button content exactly — 22+8+22 = 52px).
      // Title spans col 2 row 1; reactions span col 2 row 2.
      //
      // Pre-v0.11.2 this was `[64px_1fr]` — 12px of slack between the
      // position cell content and the gap. On a 390px iPhone the
      // slack pushed the 4-reaction row past the available width and
      // wrapped the 4th button onto a second line (operator caught
      // post-v0.11.1 deploy). Tightening to 52px gives the reactions
      // row those 12px back; confirmed-row numbers still fit cleanly
      // (1–2 digit position right-aligned inside 52px).
      //
      // Desktop (≥ lg): pulls the column template from the shared
      // CSS var so `<SetlistColumnHeader>` and `<SetlistRow>` can't
      // drift. Position col 1, title col 2, performers col 3,
      // reactions col 4 — single row. The desktop position column
      // also widened to 52px in `setlistLayout.ts` for the same
      // dual-button reason.
      className="grid grid-cols-[52px_1fr] items-start gap-x-3 px-4 py-3 lg:grid-cols-[var(--setlist-cols)] lg:gap-x-[var(--setlist-gap)] lg:px-5 lg:py-2.5 lg:hover:bg-[var(--row-hover-bg)] lg:transition-colors lg:duration-[120ms]"
    >
      {/* Position slot — col 1, row 1. NumberSlot renders the right
          glyph for the row state: plain number for confirmed,
          side-by-side ✓/✕ vote buttons for rumoured. v0.10.1
          replaces the v0.10.0 single-button [?]/[✓] shape with the
          dual-button vote pair (see plan: "Replace <FlagButton>
          with thumb-up / thumb-down"). The mailto-based FlagButton
          that lived below the title is gone — the ✕ button covers
          the "wrong row" signal with one tap instead of opening a
          mail picker. */}
      <NumberSlot
        state={rowState}
        position={index + 1}
        myVote={myVote}
        onConfirmTap={onConfirmTap}
        onDisagreeTap={onDisagreeTap}
        confirmAriaLabel={confirmT("confirmAria")}
        disagreeAriaLabel={confirmT("disagreeAria")}
      />

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
        {/* Backed unit credited but no resolvable name (rare — Artist
            with empty translations + null originalName). Falls back
            to the i18n stageType label so the row still reads as
            "this is a unit-stage performance". */}
        {!isNonSong && unitArtist && !unitArtistName && (
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
            stageType label instead so the row still indicates
            "this is a unit-stage performance" without leaking
            unlocalized operator text. Replaces the previously
            unreachable `?? stageType.{x}` fallback that lived inside
            the unitArtist-required branch above. */}
        {!isNonSong && !unitArtist && item.stageType !== "full_group" && (
          <FallbackUnitBadge
            label={t(
              `stageType.${item.stageType}` as Parameters<typeof t>[0],
            )}
          />
        )}
        {/* FlagButton (mailto:help@opensetlist.com) was removed in
            v0.10.1 — the dual-button ✓/✕ cell at the row's
            position slot now covers both confirmation AND
            disagreement signals with one tap each. Email reports
            were too high-friction at Phase 1B/1C scale; the ✕
            button is the lightweight successor. Aggregation
            behavior (N disagrees → row hidden / disputed) ships in
            Week 3 alongside `<AddItemBottomSheet>`. */}
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
  // opacity. When the operator hasn't backfilled `Artist.color`,
  // `resolveUnitColor` substitutes a deterministic palette pick keyed
  // on the slug — multiple color-pending units in the same setlist
  // render with distinguishable hues instead of all collapsing to
  // brand blue (and also matching the unit chip color on the artist
  // detail page, since that surface uses the same resolver).
  const resolved = resolveUnitColor({
    slug: artistSlug,
    color: artistColor,
  });
  const styled = {
    backgroundColor: `${resolved}18`,
    color: resolved,
  };
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
