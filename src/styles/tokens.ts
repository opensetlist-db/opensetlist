/*
 * Design tokens — single source of truth for colors / shadows / radii /
 * breakpoints across all page redesigns. Verbatim from
 * `shared-components-handoff.md` §1.
 *
 * Use `as const` so consumers get literal-typed values (e.g.
 * `typeof colors.primary` is `"#0277BD"`, not `string`) — this lets
 * `<StatusBadge size="sm" | "md">` style switches type-narrow correctly
 * when keyed off a token.
 */

export const colors = {
  // Brand
  primary: "#0277BD",
  primaryLight: "#4FC3F7",
  primaryBg: "#e8f4fd",
  primaryBorder: "#bfdbfe",
  brandGradient: "linear-gradient(135deg, #4FC3F7, #0277BD)",
  // CTA-emphasis gradient (purple terminal — used for "join the live"
  // / share buttons in mockups, not the regular primary).
  darkGradient: "linear-gradient(135deg, #4FC3F7, #7B1FA2)",

  // Text
  textPrimary: "#0f172a",
  textSecondary: "#475569",
  textMuted: "#94a3b8",
  textSubtle: "#64748b",
  // On-dark text variants for surfaces that sit on a dark gradient
  // (e.g. the series-page LIVE banner). These read as alpha-blended
  // white because the dark backgrounds vary per surface — a static
  // hex would tie the variant to one specific gradient.
  //   onDarkSubtle (0.65) — secondary helper text on a brand surface.
  //   onDarkMuted  (0.50) — fainter caption tone, used by the
  //                          series-page LIVE banner CTA per mockup.
  onDarkSubtle: "rgba(255,255,255,0.65)",
  onDarkMuted: "rgba(255,255,255,0.5)",

  // Backgrounds
  bgPage: "#f0f4f8",
  bgCard: "#ffffff",
  bgSubtle: "#f8fafc",
  bgFaint: "#fafbfc",

  // Deeper navy used as the mid-stop on the LIVE-banner gradient and
  // the home `LiveHeroCard` mid-stop. Sits between `textPrimary`
  // (#0f172a, near-black) and `primary` (#0277BD, brand blue) on the
  // hue ramp; without it the gradient jumps too abruptly between the
  // two endpoints.
  navyDeep: "#1e3a5f",

  // Borders
  border: "#e2e8f0",
  borderLight: "#f1f5f9",
  borderFaint: "#f8fafc",
  // Slightly darker than `border` — used for the dashed empty-state
  // border on inactive reaction buttons (mockup §3-3). Distinct from
  // `border` (solid e2e8f0) so the dashed-vs-solid contrast remains
  // visible at small sizes; `textMuted` would be too dark.
  borderDashed: "#d1d5db",
  // Slightly darker border / muted-glyph tone (slate-300). Used for
  // chevrons and faint divider accents that need to read above
  // `border` without becoming text-weight gray.
  borderSubtle: "#cbd5e1",

  // Card-hover wash for primary-themed surfaces (UpcomingCard).
  // Lighter than `primaryBg` so resting cards on a white page lift
  // without flashing a bright brand tint on hover.
  primaryHoverBg: "#f0f7ff",

  // Event status palette (consumed by <StatusBadge>)
  live: "#dc2626",
  liveBg: "#fef2f2",
  liveBorder: "#fecaca",

  // Confirm-row disagree button (Phase 1B/1C). Active state for
  // the 👎 button in `<NumberSlot>` when the viewer has voted
  // "wrong row." Rose family — same red end of the spectrum as
  // `live` but a deeper accent (rose-700 vs the LIVE red-600), so
  // the two tokens read as related-but-distinct semantics
  // ("happening now" vs "I disagree this is correct"). The bg is
  // light enough (~rose-50) that the button reads as a soft
  // toggle pill rather than an alarming alert.
  disagreeBg: "#fff1f2",
  disagreeText: "#9f1239",

  // Error feedback (validation + submission failures). Same red as `live`
  // today, but semantically distinct: a future brand shift moving live to
  // orange (rare but possible per CR) shouldn't recolor error text. Keep
  // both hexes here so the divergence is one-line easy if it happens.
  error: "#dc2626",

  // Predicted Setlist during-show divider (Phase 1B Stage C).
  // Amber bar separating in-rank rows from below-rank rows in the
  // live tab. Bg + text picked from
  // raw/mockups/mockup-wish-predict.jsx PredictTab during-show
  // divider. Distinct from `warning` (one-purpose token, doesn't
  // share semantics with other warning surfaces).
  predictDividerBg: "#fff8e1",
  predictDividerText: "#92400e",

  // Soft-warning feedback (e.g. edit-cooldown countdown). Distinct from
  // `error` (hard fail) and from trending-UI tokens (semantically
  // unrelated despite the same amber family).
  warning: "#d97706",
  upcoming: "#16a34a",
  upcomingBg: "#f0fdf4",
  upcomingBorder: "#bbf7d0",
  completed: "#64748b",
  completedBg: "#f8fafc",
  completedBorder: "#e2e8f0",

  // Trending TOP3 card (consumed by <TrendingSongs>)
  trendingBg: "#fffbeb",
  trendingBorder: "#fde68a",
  trendingText: "#b45309",

  // Wishlist card (Phase 1B, consumed by <EventWishSection>).
  // Blue palette per `raw/mockups/mockup-wish-predict.jsx` — distinct
  // from the brand `primary` family so the wishlist surface reads as
  // its own card alongside the amber Trending card. The match-bg /
  // match-text pair is reused by future <SongMatchBadge> consumers
  // (Predicted Setlist, Week 3) — keeping them as named tokens means
  // both surfaces share one definition.
  wishlistBg: "#f0f7ff",
  wishlistBorder: "#b5d4f4",
  // Focus border for the wishlist's compact `<SongSearch>` input.
  // Same hex as `primary` (intentional — wishlist surfaces echo the
  // brand blue on interaction). Kept as a separate token so a future
  // wishlist palette tweak doesn't accidentally repaint the brand.
  wishlistFocusBorder: "#0277BD",
  wishlistText: "#185FA5",
  wishlistMuted: "#378ADD",
  wishlistRowDivider: "#dbeafe",
  wishlistMatchBg: "#bbf7d0",
  wishlistMatchText: "#166534",

  // Song-variant / encore divider accent
  variant: "#7B1FA2",
  variantBg: "#F3E5F5",
} as const;

/*
 * Share Card design tokens (Phase 1B Stage C).
 *
 * Two themes — dark + light — picked from
 * `raw/mockups/mockup-share-card.jsx`. The card is a 600px-wide
 * standalone surface captured to PNG via html2canvas; the tokens
 * are intentionally distinct from the rest of the app so a future
 * brand tweak doesn't accidentally repaint shared images already
 * floating around social media.
 *
 * Exposed as a separate `shareCardColors` object (rather than
 * nested under `colors`) so consumers explicitly opt in
 * (`import { shareCardColors } from "@/styles/tokens"`) — the
 * card's blue palette overlaps with `colors.primary` family but
 * the alpha-glow + rgba accents would be confusing as
 * top-level entries on the main `colors` object.
 */
export type ShareCardTheme = "dark" | "light";

export interface ShareCardPalette {
  cardBg: string;
  /** "1px solid #d0e8f8" for light; "none" for dark. */
  cardBorder: string;
  /** Top accent bar gradient (light only); empty string for dark. */
  topBar: string;
  /** Radial overlay gradient (dark only); empty string for light. */
  radialOverlay: string;
  series: string;
  title: string;
  date: string;
  bannerBg: string;
  /** "1px solid #b5d4f4" for light; "1px solid rgba(79,195,247,0.2)" for dark. */
  bannerBorder: string;
  /** "0 1px 8px rgba(2,119,189,0.06)" for light; "none" for dark. */
  bannerShadow: string;
  scoreMain: string;
  scorePct: string;
  scoreSub: string;
  scoreLabel: string;
  scoreFrac: string;
  scorePred: string;
  missColor: string;
  numColor: string;
  hitRowBg: string;
  hitDot: string;
  hitDotGlow: string;
  hitUnderline: string;
  hitText: string;
  encLine: string;
  encLabel: string;
  footerBorder: string;
  footerBrand: string;
  footerUrl: string;
}

/*
 * z-index layering tokens. Centralizes the magic numbers that
 * sprinkle inline `style={{ zIndex: 100 }}` values across the
 * codebase — without a single source of truth, a future overlay
 * (drawer, toast, secondary modal) can silently land at the wrong
 * layer.
 *
 * Higher = closer to the user. Gaps left between buckets so a
 * future intermediate layer can slot in without renumbering.
 */
export const zIndex = {
  /** Sticky elements within page flow (e.g. desktop sidebar). */
  sticky: 10,
  /** Modal backdrop + dialog (Share Card, Flag dialogs). */
  modal: 200,
  /** Toast / snackbar / inline announcement above modals. */
  toast: 300,
} as const;

export const shareCardColors: Record<ShareCardTheme, ShareCardPalette> = {
  dark: {
    cardBg:        "#0a1628",
    cardBorder:    "none",
    topBar:        "",
    // Two ellipses at opposite corners, transparent past 55% to
    // keep the card readable under the score banner + setlist rows.
    radialOverlay:
      "radial-gradient(ellipse at 15% 0%, rgba(79,195,247,0.12) 0%, transparent 55%), radial-gradient(ellipse at 85% 100%, rgba(2,119,189,0.15) 0%, transparent 55%)",
    series:        "#4FC3F7",
    title:         "#e8f4fd",
    date:          "#3a5a7a",
    bannerBg:      "rgba(79,195,247,0.08)",
    bannerBorder:  "1px solid rgba(79,195,247,0.2)",
    bannerShadow:  "none",
    scoreMain:     "#e8f4fd",
    scorePct:      "#4FC3F7",
    scoreSub:      "#3a5a7a",
    scoreLabel:    "#4FC3F7",
    scoreFrac:     "#4FC3F7",
    scorePred:     "#2a4a6a",
    missColor:     "#7a9ab8",
    numColor:      "#2a4464",
    hitRowBg:      "rgba(79,195,247,0.07)",
    hitDot:        "#4FC3F7",
    hitDotGlow:    "0 0 5px rgba(79,195,247,0.9)",
    hitUnderline:  "rgba(79,195,247,0.5)",
    hitText:       "#e8f4fd",
    encLine:       "rgba(79,195,247,0.1)",
    encLabel:      "#1e3a56",
    footerBorder:  "rgba(79,195,247,0.1)",
    footerBrand:   "#1e3a56",
    footerUrl:     "#1e3a56",
  },
  light: {
    cardBg:        "#f8fbff",
    cardBorder:    "1px solid #d0e8f8",
    topBar:        "linear-gradient(90deg, #4FC3F7, #0277BD)",
    radialOverlay: "",
    series:        "#0277BD",
    title:         "#0c1a2e",
    date:          "#8aacc8",
    bannerBg:      "white",
    bannerBorder:  "1px solid #b5d4f4",
    bannerShadow:  "0 1px 8px rgba(2,119,189,0.06)",
    scoreMain:     "#0c1a2e",
    scorePct:      "#0277BD",
    scoreSub:      "#8aacc8",
    scoreLabel:    "#0277BD",
    scoreFrac:     "#0277BD",
    scorePred:     "#b5cfe8",
    missColor:     "#5a8ab0",
    numColor:      "#b5d4f4",
    hitRowBg:      "#eef7ff",
    hitDot:        "#0277BD",
    hitDotGlow:    "none",
    hitUnderline:  "rgba(2,119,189,0.4)",
    hitText:       "#0c1a2e",
    encLine:       "#d0e8f8",
    encLabel:      "#b5cfe8",
    footerBorder:  "#d0e8f8",
    footerBrand:   "#8aacc8",
    footerUrl:     "#b5cfe8",
  },
} as const;

/*
 * Fallback palette for unit-type artists whose `Artist.color` hasn't
 * been backfilled yet. Picked to read as distinct hues at small pill
 * sizes while staying out of the semantic color territory:
 *   - no pure red (collides with `live`), green (`upcoming`), or
 *     `colors.primary` blue
 *   - Tailwind 400-500 family — vibrant enough to feel anime-IP-flavored
 *     (matching how Hasunosora-class catalogs lean bright in their
 *     official branding) while still readable both as a ~12% alpha
 *     background tint (`${color}18`) and as foreground text at full
 *     opacity. The earlier Material 700-shade set looked noticeably
 *     dull on `/ko/artists/1/hasunosora`'s 9 color-pending sub-units;
 *     operator visual review (2026-04) explicitly approved lifting the
 *     palette ~2 shade levels.
 *   - 17 entries — empirically the smallest palette size at which
 *     the FNV-1a + Murmur3-fmix hash in
 *     `src/lib/artistColor.ts#hashUnitSlug` distributes the nine
 *     Hasunosora sub-unit slugs onto distinct buckets. Smaller
 *     palettes (10, 12, 16) collapse 2–4 pairs because the hash's
 *     mod-N output isn't uniform on short ASCII slugs. Bigger
 *     palettes are fine but waste curated entries.
 *
 * Indexed by a stable hash of the unit's slug (see
 * `src/lib/artistColor.ts#resolveUnitColor`). The hash is unchanged
 * across the re-skin, so per-slug determinism still holds: the same
 * unit always lands on the same palette index across renders / pages.
 * DO NOT reorder existing entries — order changes shift every unit's
 * auto-color until operators backfill explicit values. New entries
 * should be appended at the end, never inserted mid-list. The current
 * values are the new baseline (replacing the prior Material 700 set);
 * future operator-driven re-skins follow the same "approved swap"
 * convention rather than ad-hoc tweaks.
 */
export const unitFallbackPalette = [
  "#EC4899", // 0 pink-500 — hot pink
  "#F97316", // 1 orange-500 — vivid orange
  "#A855F7", // 2 purple-500 — bright purple
  "#14B8A6", // 3 teal-500 — bright teal
  "#FACC15", // 4 yellow-400 — sunny yellow
  "#6366F1", // 5 indigo-500 — bright indigo
  "#D946EF", // 6 fuchsia-500 — vivid fuchsia
  "#06B6D4", // 7 cyan-500 — bright cyan
  "#FB923C", // 8 orange-400 — light orange / coral
  "#8B5CF6", // 9 violet-500 — bright violet
  "#FBBF24", // 10 amber-400 — golden amber
  "#2DD4BF", // 11 teal-400 — turquoise
  "#C084FC", // 12 purple-400 — light purple / lilac
  "#F472B6", // 13 pink-400 — light pink
  "#FB7185", // 14 rose-400 — coral pink
  "#FCD34D", // 15 amber-300 — soft yellow
  "#A3A3A3", // 16 neutral-400 — soft gray
] as const;

export const shadows = {
  card: "0 1px 3px rgba(0,0,0,0.06), 0 4px 16px rgba(2,119,189,0.06)",
  nav: "0 1px 3px rgba(0,0,0,0.04)",
  // Heavier brand-color glow for the LIVE hero card on the home page.
  // Same brand RGB as `card` (rgba of `colors.primary` #0277BD) but at
  // a deeper alpha + larger blur for a "lifted off the page" feel.
  heroLive: "0 8px 32px rgba(2,119,189,0.25)",
} as const;

export const radius = {
  // Card-radius scale, in ascending order. `card` is the regular size
  // (most surfaces); `cardSm` is the compact card variant used by the
  // home `UpcomingCard`; `cardLg` is the hero treatment for surfaces
  // that need more prominence than a regular card (home `LiveHeroCard`).
  cardSm: 14,
  card: 16,
  cardLg: 20,
  badge: 20,
  button: 20,
  tag: 10,
  // Sub-unit chip on artist rows (mockup §2). Numerically same as
  // `tag` today but semantically distinct — `tag` is for content
  // tags, `chip` is for sub-entity references; keeping them separate
  // lets a future design tweak adjust one without churning the other.
  chip: 10,
  avatar: 14,
} as const;

export const breakpoint = {
  desktop: 1024,
} as const;

/*
 * Layout-scale constants. `navHeight` is the sticky `<Nav>` height
 * (mobile/desktop) — surfaces below the nav that need to clear it
 * (sticky sidebars, anchor-link `scroll-margin-top`) derive from
 * here so a future nav-height change propagates to all consumers.
 */
export const layout = {
  navHeight: { mobile: 52, desktop: 56 },
} as const;

// Border-width scale. `emphasis` is the slightly heavier stroke used on
// surfaces that need to read as "the user's own" (my-impression card) or
// "active selection" (reaction button mine-state). Most other surfaces
// use 1px directly via Tailwind utilities or inline style.
export const borderWidth = {
  emphasis: "1.5px",
} as const;

/*
 * Motion shorthands. Currently a single entry — the LIVE-status pulse
 * shared by `<StatusBadge status="ongoing">` (the `● LIVE` dot in
 * row-shaped surfaces) and `<LiveHeroCard>` (the dot inside the dark
 * gradient hero). Both must agree on the keyframe + cadence so a
 * design tweak doesn't fall out of sync between surfaces.
 */
export const motion = {
  livePulse: "live-pulse 1.2s ease-in-out infinite",
} as const;

/*
 * Composite gradients beyond `colors.brandGradient` /
 * `colors.darkGradient`. `liveBanner` is the dark-navy ramp used by
 * the series-page LIVE banner — same `textPrimary` → deeper-navy
 * `#1e3a5f` arc that the home `LiveHeroCard` mid-stop already pins.
 *
 * `progressBar` is the horizontal (90deg) brand ramp used by the
 * series-page tour-progress fill. Distinct from `colors.brandGradient`
 * (135deg) because a horizontal gradient reads cleanly as "fill from
 * left" on a 6px-tall bar, whereas a 135deg diagonal banding looks
 * smudged at that height.
 */
export const gradients = {
  liveBanner: `linear-gradient(135deg, ${colors.textPrimary}, ${colors.navyDeep})`,
  progressBar: `linear-gradient(90deg, ${colors.primaryLight}, ${colors.primary})`,
} as const;

/*
 * Compose a partially-transparent CSS color from a hex token. Lets
 * decorative surfaces (e.g. blob backgrounds, glows) reference a
 * `colors.*` token directly without keeping a parallel `r,g,b` string
 * that can drift out of sync. Throws on invalid hex so a malformed
 * token fails loud at boot, not silently as `rgba(NaN,NaN,NaN,...)`
 * at runtime.
 */
export function rgbaFromHex(hex: string, alpha: number): string {
  if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
    throw new Error(`rgbaFromHex: invalid alpha "${alpha}"`);
  }
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`rgbaFromHex: invalid hex "${hex}"`);
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
