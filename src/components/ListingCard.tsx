import { getTranslations } from "next-intl/server";
import { colors, radius, shadows } from "@/styles/tokens";
import {
  resolveStoreName,
  resolveEditionLabel,
  resolveBonusType,
  resolveStoreKey,
  mapStatusToUiKey,
  type EnrichedListing,
  type EnrichedBonus,
} from "@/lib/albumBonusDisplay";
import { TrackedStoreLink } from "@/components/TrackedStoreLink";
// Limits the buy-button anchor to genuine external URLs. Operator
// types productUrl as free-text in admin (per the b03↔b05
// simplification handoff — no closed allowlist of stores), so a
// hostile or accidental value like `javascript:alert(1)` /
// `data:text/html,...` would otherwise reach the rendered href.
// Lifted to lib/utils.ts so the admin surface (ListingsClient) can
// apply the same scheme allowlist instead of rendering operator-typed
// hrefs verbatim — single source of truth for the http/https-only
// check.
import { isSafeExternalUrl } from "@/lib/utils";

/*
 * Card render for a single AlbumStoreListing — one row per
 * (album × store × edition) in b03's bonus tab grid.
 *
 * Layout (per b03↔b05 simplification handoff):
 *   ┌────────────────────────────────────────────┐
 *   │  매장명 · 상품명                  [판매중]  │
 *   │  ─────────────────────────────────────────  │
 *   │  ┌────────────────┐                        │
 *   │  │   구매하기 →   │                        │
 *   │  └────────────────┘                        │
 *   │  • B2 タペストリー (Mira)                  │
 *   │  • B2 タペストリー (Cerise)                │
 *   │  • B2 タペストリー (Dolls)                 │
 *   └────────────────────────────────────────────┘
 *
 * The card never renders sourceUrl, lifecycle dates, stale warnings,
 * bonus descriptions, bonus images, or bonus-level lifecycle overrides
 * — the schema columns exist but the b03 surface deliberately leaves
 * them off per the operator-data-entry-burden trade-off.
 *
 * `muted` variant: rendered inside the ended-listings <details>
 * collapse. Drops the buy button (no point linking to a sale that's
 * over) and softens the badge / text colors so the card visually
 * recedes vs. the active ones above.
 */

interface Props {
  listing: EnrichedListing & { bonuses: EnrichedBonus[] };
  locale: string;
  muted?: boolean;
  /**
   * Render mode when the card sits inside an outer single big-box
   * wrapper (the AlbumBonusTab pattern that mirrors the events tab's
   * PerformanceGroup shell). Drops the card's own background /
   * borderRadius / boxShadow / border so the outer wrapper paints
   * them once for the whole stack — same visual rhythm as
   * PerformanceGroup's inline event rows.
   */
  embedded?: boolean;
  /**
   * Hairline rule above the card body — used only by `embedded`
   * mode to separate inline rows inside the outer wrapper. Has no
   * effect when `embedded` is false (each card already carries its
   * own borderRadius / box edge in the standalone shape).
   */
  dividerAbove?: boolean;
  /**
   * Album id (string) for the b10c `store_click` GA event. When set,
   * the buy button is rendered through <TrackedStoreLink> so clicks
   * fire `store_click` (surface `album_page`). Omitted by admin call
   * sites (ListingsClient / AlbumListingFormModal) so operator clicks
   * never reach analytics — those render a plain anchor instead.
   */
  albumId?: string;
}

export async function ListingCard({
  listing,
  locale,
  muted = false,
  embedded = false,
  dividerAbove = false,
  albumId,
}: Props) {
  const t = await getTranslations({ locale, namespace: "Album.bonus" });
  const storeName = resolveStoreName(listing, locale);
  const editionLabel = resolveEditionLabel(listing, locale);
  const uiStatus = mapStatusToUiKey(listing.status);

  return (
    <article
      style={{
        // In `embedded` mode the outer wrapper paints the bgCard +
        // borderRadius + boxShadow once for the whole stack, so each
        // card stays transparent + sharp-edged. Standalone shape
        // (muted variant, or any future caller using ListingCard on
        // its own) keeps the per-card box.
        background: embedded
          ? "transparent"
          : muted
            ? colors.bgSubtle
            : colors.bgCard,
        borderRadius: embedded ? 0 : radius.card,
        boxShadow: embedded || muted ? "none" : shadows.card,
        border:
          embedded
            ? "none"
            : muted
              ? `1px solid ${colors.borderSubtle}`
              : "none",
        // Hairline rule above the card body in embedded mode (skip
        // for the first card in the stack via the `dividerAbove`
        // prop). Matches PerformanceGroup's inter-row separator.
        borderTop: embedded && dividerAbove
          ? `1px solid ${colors.borderLight}`
          : undefined,
        // Horizontal padding aligned with the events tab's
        // PerformanceGroup row padding (16px) so the inner content
        // edge sits at the same offset from the card box edge
        // across all three tabs.
        padding: "16px",
        opacity: muted ? 0.78 : 1,
        // Width 100% explicit so the card stretches to the wrapper
        // column edge — the flex parent's default `align-items:
        // stretch` should already do this, but pinning here is a
        // defense against future style edits and matches the
        // width-pinning the album-bonus / album-tracks tab outer
        // wrappers carry for the same reason.
        width: "100%",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 12,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <h3
            style={{
              margin: 0,
              fontSize: 15,
              fontWeight: 700,
              color: muted ? colors.textSubtle : colors.textPrimary,
              wordBreak: "break-word",
            }}
          >
            {storeName}
          </h3>
          {editionLabel ? (
            <p
              style={{
                margin: "2px 0 0",
                fontSize: 13,
                color: colors.textSubtle,
                wordBreak: "break-word",
              }}
            >
              {editionLabel}
            </p>
          ) : null}
        </div>
        <StatusBadge label={t(`status.${uiStatus}`)} variant={uiStatus} />
      </header>

      {!muted && isSafeExternalUrl(listing.productUrl)
        ? (() => {
            const buyStyle = {
              display: "inline-block",
              padding: "8px 16px",
              background: colors.primary,
              color: "white",
              borderRadius: radius.tag,
              fontSize: 13,
              fontWeight: 700,
              textDecoration: "none",
              marginBottom: listing.bonuses.length > 0 ? 14 : 0,
            } as const;
            const label = `${t("buy")} →`;
            // Tracked (album-page) vs plain (admin) per `albumId`
            // presence — admin previews don't fire `store_click`.
            // `bonus_id` is omitted: productUrl is per-listing, the
            // bonuses below have no own link (b01 data model).
            return albumId ? (
              <TrackedStoreLink
                href={listing.productUrl}
                albumId={albumId}
                storeKey={resolveStoreKey(listing.originalStoreName)}
                storeStatus={listing.status}
                surface="album_page"
                isAffiliate={false}
                style={buyStyle}
              >
                {label}
              </TrackedStoreLink>
            ) : (
              <a
                href={listing.productUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={buyStyle}
              >
                {label}
              </a>
            );
          })()
        : null}

      {listing.bonuses.length > 0 ? (
        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: 6,
            // Divider only when the buy button actually rendered above —
            // share the same guard used for the button itself so a
            // rejected (unsafe) productUrl doesn't leave a phantom
            // divider line floating without anything above it.
            borderTop:
              !muted && isSafeExternalUrl(listing.productUrl)
                ? `1px solid ${colors.borderLight}`
                : "none",
            paddingTop:
              !muted && isSafeExternalUrl(listing.productUrl) ? 12 : 0,
          }}
        >
          {listing.bonuses.map((bonus) => (
            <li
              key={bonus.id}
              style={{
                fontSize: 14,
                color: muted ? colors.textMuted : colors.textPrimary,
                wordBreak: "break-word",
              }}
            >
              {/* The disc bullet sits inline rather than via ::marker
                  so its color tracks the muted variant without an
                  extra ::marker CSS rule. */}
              <span aria-hidden="true" style={{ color: colors.textMuted, marginRight: 8 }}>
                •
              </span>
              {resolveBonusType(bonus, locale)}
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

function StatusBadge({
  label,
  variant,
}: {
  label: string;
  variant: "active" | "ended";
}) {
  // active = primary-tinted bg + white text (reads as actionable);
  // ended  = muted-bg + subtle text (reads as inert / archival).
  const isActive = variant === "active";
  return (
    <span
      style={{
        flexShrink: 0,
        padding: "4px 10px",
        background: isActive ? colors.primary : colors.bgSubtle,
        color: isActive ? "white" : colors.textSubtle,
        borderRadius: radius.tag,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.04em",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}
