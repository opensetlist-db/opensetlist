import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { Prisma } from "@/generated/prisma/client";
import {
  resolveEventBdState,
  selectTopBonuses,
  type EventBdState,
} from "@/lib/eventBdState";
import {
  resolveStoreName,
  resolveBonusType,
} from "@/lib/albumBonusDisplay";
import {
  displayOriginalTitle,
  displayOriginalName,
} from "@/lib/display";
import { formatDate } from "@/lib/utils";
import type { BigIntStringified } from "@/lib/utils";
import { colors, radius, shadows } from "@/styles/tokens";

/*
 * EventBdSection — mounts between the Setlist card and the Impressions
 * card on `/[locale]/events/[id]/...`. Surfaces the linked BD Album's
 * lifecycle (announce → preorder → release) plus a top-3 매장特典
 * preview. State machine + bonus selector live in `src/lib/eventBdState.ts`.
 *
 * Authoritative visual reference: the v2 mockup files at
 *   F:\work\vaults\opensetlist\raw\mockups\event-page-v2-mockup.jsx
 *   F:\work\vaults\opensetlist\raw\mockups\event-page-desktop-v2-mockup.jsx
 * Both v1 mockup files predate this section — do not use them.
 *
 * Position invariant: between Setlist and Impressions. Mounted by
 * `LiveEventLayout` via the `bdSection` slot prop because that wrapper
 * owns the column layout grid (`lg:grid-cols-[300px_1fr]`) and the
 * sibling order has to be deterministic for both mobile (single column)
 * and desktop (main column) renderings.
 *
 * Server-component: state resolution + bonus selection + i18n all run
 * on the server. Re-renders on the next page load when the BD lifecycle
 * advances (announce → preorder → release). BD timelines are in months,
 * not seconds, so there's no client-side ticker.
 */

// Wire-shape contract. The page's `getEvent()` returns a payload that
// for this component's bdAlbum slice has been re-run through
// `serializeBigIntAsString` (the String variant — see the page's
// EventBdSection mount comment for why), so every `bigint` arrives as
// `string` and every `Date` arrives as ISO `string`. The
// `BigIntStringified<T>` type companion mirrors that exact runtime
// shape — used identically by AlbumInfoCard / ListingCard /
// AlbumBonusTab so the bonus-display helpers
// (resolveStoreName / resolveBonusType) type-check cleanly here.
export type EventBdAlbumInput = BigIntStringified<
  Prisma.AlbumGetPayload<{
    include: {
      translations: true;
      artists: {
        include: {
          artist: { include: { translations: true } };
        };
      };
      listings: {
        include: {
          translations: true;
          bonuses: { include: { translations: true } };
        };
      };
    };
  }>
>;

// Event slice consumed by the section. Stays narrower than the page's
// full event shape — only the four columns the resolver + render path
// actually read. The bdAlbum subtree is pre-converted with
// `serializeBigIntAsString` (String-id variant) at the page boundary;
// the surrounding event fields stay at their `serializeBigInt`
// (Number-id) wire shape, but the resolver only reads `bdAlbumId` for
// presence / nullness — coercion-tolerant either way.
export type EventBdEventInput = {
  id: string | number | bigint;
  startTime: string | Date | null;
  status: Prisma.EventGetPayload<object>["status"];
  bdAlbumId: string | number | bigint | null;
  bdAlbum: EventBdAlbumInput | null;
};

interface Props {
  event: EventBdEventInput;
  locale: string;
  /**
   * Anchor every status read to the same `now`. Snap-frozen at the
   * page server function and threaded through so the BD state matches
   * the resolved event status the rest of the page renders against —
   * see the `referenceNow` rationale on `getEventStatus`.
   */
  referenceNow: Date;
}

export async function EventBdSection({ event, locale, referenceNow }: Props) {
  const album = event.bdAlbum;
  const state = resolveEventBdState(
    {
      startTime: event.startTime ?? "",
      status: event.status,
      bdAlbumId: event.bdAlbumId,
    },
    album
      ? {
          releaseDate: album.releaseDate,
          listings: album.listings.map((l) => ({
            status: l.status,
            startsAt: l.startsAt,
            endsAt: l.endsAt,
            bonuses: l.bonuses.map((b) => ({
              startsAt: b.startsAt,
              endsAt: b.endsAt,
              bonusImageUrl: b.bonusImageUrl,
            })),
          })),
        }
      : null,
    referenceNow,
  );

  // pre / immediate_post / cancelled / no-album-but-time-bucket-says-hide
  // — all collapse to no render. The teaser banner takes over once we
  // hit long_mid; only the three post-link buckets render the full
  // section.
  if (state === "pre" || state === "immediate_post") return null;

  const t = await getTranslations({ locale, namespace: "Event" });

  if (state === "long_mid") {
    return <LongMidTeaser title={t("bd.teaserTitle")} body={t("bd.teaserBody")} />;
  }

  // All three post-link states need the album + its primary artist
  // resolved. The resolver above already guards `album !== null` for
  // these states; refining for TS.
  if (!album) return null;

  return (
    <FullVariant
      state={state}
      album={album}
      locale={locale}
      referenceNow={referenceNow}
      t={t}
    />
  );
}

// ── long_mid teaser banner ────────────────────────────────
// Light single-row preview surface; no album info, no bonus.
// Renders even when no `bdAlbumId` is set yet — the operator hasn't
// linked the BD row in admin, but the time bucket says "BD news is
// plausibly imminent." Used to hint to fans that a BD section will
// surface here once announced.

function LongMidTeaser({ title, body }: { title: string; body: string }) {
  return (
    <section
      style={{
        background: colors.bgCard,
        borderRadius: radius.card,
        marginBottom: 12,
        boxShadow: shadows.card,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          background: `linear-gradient(135deg, ${colors.primary}15, ${colors.primary}05)`,
          borderLeft: `3px solid ${colors.primary}`,
          padding: "14px 16px",
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <span style={{ fontSize: 24, flexShrink: 0 }} aria-hidden="true">
          💿
        </span>
        <div>
          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: colors.textPrimary,
              marginBottom: 3,
            }}
          >
            {title}
          </div>
          <div style={{ fontSize: 12, color: colors.textSubtle }}>{body}</div>
        </div>
      </div>
    </section>
  );
}

// ── full variant (bd_announced / bd_preorder / bd_released) ──
// One JSX block; the three states differ in:
//   - status badge text (predict / preorder / released)
//   - bonus preview presence (announced: hide; preorder/released: show
//                              top-3, hide block if released-with-none)
//   - CTA label + style (details / compare / purchase)
// The variant comments below mark each conditional slot.

type FullVariantState = Exclude<
  EventBdState,
  "pre" | "immediate_post" | "long_mid"
>;

interface FullVariantProps {
  state: FullVariantState;
  album: EventBdAlbumInput;
  locale: string;
  referenceNow: Date;
  t: Awaited<ReturnType<typeof getTranslations>>;
}

async function FullVariant({
  state,
  album,
  locale,
  referenceNow,
  t,
}: FullVariantProps) {
  // Original-title-primary for the album row (artwork identity — same
  // rule the song detail and album page sidebar follow).
  const titleParts = displayOriginalTitle(album, album.translations, locale);

  // Primary artist for the album. AlbumArtist junction has no role
  // column; pick the first credited row. Matches AlbumInfoCard's
  // policy.
  const primaryArtistRow = album.artists[0] ?? null;
  const primaryArtist = primaryArtistRow?.artist ?? null;
  const primaryArtistName = primaryArtist
    ? displayOriginalName(primaryArtist, primaryArtist.translations, locale).main
    : null;

  // Pick top-3 bonuses only when the variant renders them. announced
  // skips this entirely; bd_released may return an empty array (no
  // active bonus remaining) and the rendering branch collapses the
  // block in that case.
  const showsBonuses = state === "bd_preorder" || state === "bd_released";
  const topBonuses = showsBonuses
    ? selectTopBonuses(
        album.listings.map((l) => ({
          ...l,
          originalStoreName: l.originalStoreName,
        })),
        referenceNow,
      )
    : [];

  // Status badge — three label variants matching the v2 mockup.
  const badge = pickBadge(state, t);

  const albumHref = `/${locale}/albums/${album.id}/${album.slug}`;

  // CTA: details (announced, neutral), compare (preorder, brand
  // gradient), purchase (released, brand gradient). All three link
  // to the Album page where the full listing + bonus catalog lives.
  const cta = pickCta(state, t);

  return (
    <section
      style={{
        background: colors.bgCard,
        borderRadius: radius.card,
        marginBottom: 12,
        boxShadow: shadows.card,
        overflow: "hidden",
      }}
    >
      {/* Section header — title + state-specific badge */}
      <div
        style={{
          padding: "14px 16px 12px",
          borderBottom: `1px solid ${colors.borderLight}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: colors.textPrimary,
          }}
        >
          {t("bd.sectionTitle")}
        </span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: badge.color,
            background: badge.bg,
            border: `1px solid ${badge.border}`,
            borderRadius: radius.badge,
            padding: "2px 8px",
          }}
        >
          {badge.label}
        </span>
      </div>

      <div style={{ padding: "14px 16px" }}>
        {/* Album info row — cover + title + release date / preorder deadline */}
        <Link
          href={albumHref}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 14,
            // When a bonus preview block follows, this Link draws a
            // hairline divider between the album info row and the
            // bonus list. Without bonuses the row sits flush against
            // the CTA below it (no divider, no extra bottom padding).
            paddingBottom: showsBonuses && topBonuses.length > 0 ? 14 : 0,
            borderBottom:
              showsBonuses && topBonuses.length > 0
                ? `1px solid ${colors.borderLight}`
                : "none",
            textDecoration: "none",
            color: "inherit",
          }}
        >
          {album.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={album.imageUrl}
              alt={titleParts.main}
              referrerPolicy="no-referrer"
              style={{
                width: 60,
                height: 60,
                borderRadius: radius.tag,
                flexShrink: 0,
                objectFit: "cover",
                boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
              }}
            />
          ) : (
            <div
              aria-hidden="true"
              style={{
                width: 60,
                height: 60,
                borderRadius: radius.tag,
                flexShrink: 0,
                background: `linear-gradient(135deg, ${colors.primary}30, ${colors.primary}60)`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 26,
                boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
              }}
            >
              💿
            </div>
          )}

          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: colors.textPrimary,
                lineHeight: 1.4,
                marginBottom: titleParts.sub ? 3 : 4,
              }}
            >
              {titleParts.main}
            </div>
            {titleParts.sub ? (
              <div
                style={{
                  fontSize: 11,
                  color: colors.textMuted,
                  marginBottom: 4,
                }}
              >
                {titleParts.sub}
              </div>
            ) : null}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {album.releaseDate ? (
                <span style={{ fontSize: 11, color: colors.textSubtle }}>
                  {/* "발매: <date>" / "発売: <date>" / "Release: <date>" */}
                  {t("bd.releaseDateLabel")}: {formatDate(album.releaseDate, locale)}
                </span>
              ) : null}
              {primaryArtistName ? (
                <span style={{ fontSize: 11, color: colors.textSubtle }}>
                  {primaryArtistName}
                </span>
              ) : null}
            </div>
          </div>

          <span
            style={{
              fontSize: 14,
              color: colors.borderSubtle,
              flexShrink: 0,
            }}
            aria-hidden="true"
          >
            ›
          </span>
        </Link>

        {/* Bonus preview — bd_preorder / bd_released (only when ≥1 active) */}
        {showsBonuses && topBonuses.length > 0 ? (
          <div style={{ marginBottom: 14 }}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: colors.textMuted,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                marginBottom: 10,
              }}
            >
              {t("bd.bonusPreviewHeading")}
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {topBonuses.map(({ bonus, listing }) => {
                const storeName = resolveStoreName(listing, locale);
                const bonusLabel = resolveBonusType(bonus, locale);
                return (
                  <div
                    key={bonus.id}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 10,
                      padding: "10px 12px",
                      background: colors.bgFaint,
                      borderRadius: radius.tag,
                      border: `1px solid ${colors.borderLight}`,
                    }}
                  >
                    <span
                      style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }}
                      aria-hidden="true"
                    >
                      ▶
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          marginBottom: 3,
                          flexWrap: "wrap",
                        }}
                      >
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 700,
                            color: colors.textPrimary,
                          }}
                        >
                          {storeName}
                        </span>
                        <span
                          style={{
                            fontSize: 10,
                            color: colors.textSubtle,
                          }}
                        >
                          {bonusLabel}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {/* CTA — details / compare / purchase. All three link to the
            Album page where the full surface lives. */}
        <Link
          href={albumHref}
          style={{
            display: "block",
            width: "100%",
            padding: "10px 0",
            borderRadius: radius.button,
            textAlign: "center",
            textDecoration: "none",
            fontSize: 13,
            fontWeight: 700,
            background: cta.background,
            color: cta.color,
            border: cta.border,
          }}
        >
          {cta.label}
        </Link>
      </div>
    </section>
  );
}

// ── helpers (badge + CTA per state) ──────────────────────

function pickBadge(
  state: FullVariantState,
  t: Awaited<ReturnType<typeof getTranslations>>,
): { label: string; color: string; bg: string; border: string } {
  if (state === "bd_announced") {
    return {
      label: t("bd.announcedBadge"),
      color: colors.textSubtle,
      bg: colors.bgSubtle,
      border: colors.border,
    };
  }
  if (state === "bd_preorder") {
    return {
      label: t("bd.preorderBadge"),
      color: colors.primary,
      bg: colors.primaryBg,
      border: colors.primaryBorder,
    };
  }
  // bd_released
  return {
    label: t("bd.releasedBadge"),
    color: colors.upcoming,
    bg: colors.upcomingBg,
    border: colors.upcomingBorder,
  };
}

function pickCta(
  state: FullVariantState,
  t: Awaited<ReturnType<typeof getTranslations>>,
): { label: string; background: string; color: string; border: string } {
  if (state === "bd_announced") {
    return {
      label: t("bd.detailsCta"),
      background: colors.borderLight,
      color: colors.textSecondary,
      border: "none",
    };
  }
  if (state === "bd_preorder") {
    return {
      label: t("bd.compareCta"),
      background: colors.brandGradient,
      color: "white",
      border: "none",
    };
  }
  // bd_released
  return {
    label: t("bd.purchaseCta"),
    background: colors.brandGradient,
    color: "white",
    border: "none",
  };
}
