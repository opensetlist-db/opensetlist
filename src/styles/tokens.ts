/*
 * Design tokens — single source of truth for colors / shadows / radii /
 * breakpoints across all page redesigns. Verbatim from
 * `shared-components-handoff.md` §1.
 *
 * Use `as const` so consumers get literal-typed values (e.g.
 * `typeof colors.primary` is `"#165DCC"`, not `string`) — this lets
 * `<StatusBadge size="sm" | "md">` style switches type-narrow correctly
 * when keyed off a token.
 */

export const colors = {
  // Brand. Values from the approved redesign common contract (ticket 03,
  // packet 03-v1.1 — `wiki/output/redesign/handoffs/03/v1.1/design-contract.md`).
  // Swapped site-wide in one place so every page picks up the new
  // palette without per-page rewrites; page layouts change only in their
  // own redesign tickets. `primaryLight` and the two gradients keep the
  // original symbol-derived hues on purpose: they paint the brand mark
  // and existing hero surfaces, and the contract does not restate them.
  primary: "#165DCC",
  // Interaction states for primary buttons/links (white text on all three
  // passes 4.5:1 — measured in the 03 packet's qa-report.json).
  primaryHover: "#104AA9",
  primaryPressed: "#0C3D8C",
  primaryLight: "#4FC3F7",
  primaryBg: "#EAF2FF",
  primaryBorder: "#D2E1FA",
  brandGradient: "linear-gradient(135deg, #4FC3F7, #0277BD)",
  // CTA-emphasis gradient (purple terminal — used for "join the live"
  // / share buttons in mockups, not the regular primary).
  darkGradient: "linear-gradient(135deg, #4FC3F7, #7B1FA2)",

  // Text
  // Main / secondary text per the 03 contract. `textSecondary` and
  // `textSubtle` collapse onto the contract's single secondary tone
  // (#52617A, 4.5:1+ on white and on bgPage). `textMuted` was #94a3b8
  // (≈2.6:1 on white — below body-text contrast); it now takes the
  // contract's disabled/meta tone so captions stay readable.
  textPrimary: "#172445",
  textSecondary: "#52617A",
  textMuted: "#67758B",
  textSubtle: "#52617A",
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
  bgPage: "#F7F9FD",
  bgCard: "#ffffff",
  bgSubtle: "#f8fafc",
  bgFaint: "#fafbfc",

  // Deeper navy used as the mid-stop on the LIVE-banner gradient. Sits between `textPrimary`
  // (#0f172a, near-black) and `primary` (#0277BD, brand blue) on the
  // hue ramp; without it the gradient jumps too abruptly between the
  // two endpoints.
  navyDeep: "#1e3a5f",

  // Borders. `border` is the decorative hairline; `borderStrong` is the
  // functional boundary (inputs, secondary buttons) that must reach 3:1
  // against the surface so the control edge is perceivable.
  border: "#DCE3EF",
  borderStrong: "#7C8BA3",

  // Keyboard focus ring (3px, 4px offset on light surfaces — applied
  // globally via `:focus-visible` in globals.css).
  focus: "#174FAF",

  // Supporting pastel accents from the 03 contract. Backgrounds only —
  // never used as text colour.
  accentPink: "#FFF0F6",
  accentLavender: "#F0EDFF",
  accentBlue: "#EAF2FF",

  // EventArt typography-fallback surface (03 contract card art): neutral
  // blue → lavender → pink wash plus its three text tones (eyebrow,
  // title, caption), all ≥4.5:1 on the wash.
  artWash: "linear-gradient(130deg, #eaf1ff, #f1edff 60%, #ffedf5)",
  artEyebrow: "#4f5781",
  artTitle: "#343b72",
  artCaption: "#575474",
  // Album-cover fallback fill.
  coverFallbackBg: "#f2f4f9",
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

  // Card-hover wash for primary-themed surfaces.
  // Lighter than `primaryBg` so resting cards on a white page lift
  // without flashing a bright brand tint on hover.
  primaryHoverBg: "#EDF4FF",
  // Pressed wash for the same quiet surfaces (nav links, locale and icon
  // buttons). Paired with `primaryHoverBg`; both are mirrored as CSS
  // variables in globals.css for the `.shell-interactive` class.
  primaryPressedBg: "#DAE7FF",

  // Event status palette (consumed by <StatusBadge>)
  live: "#dc2626",
  liveBg: "#fef2f2",
  liveBorder: "#fecaca",

  // Confirm-row disagree button (Phase 1B/1C). Active state for
  // the ✕ button in `<NumberSlot>` when the viewer has voted
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
  // unrelated despite the same amber family). Foreground + background
  // pair kept adjacent in the file, matching the pairing convention
  // every other status family (upcoming / completed / live / etc.)
  // already follows.
  warning: "#d97706",
  warningBg: "#fff3e0",
  upcoming: "#16a34a",
  upcomingBg: "#f0fdf4",
  upcomingBorder: "#bbf7d0",
  completed: "#64748b",
  completedBg: "#f8fafc",
  completedBorder: "#e2e8f0",

  // Concert-list palette (approved packet 16-v1, all text pairs ≥4.5:1
  // in its contrast.json). Separate from the status family above, which
  // the detail/home surfaces still use until their own page tickets.
  listCompletedBg: "#EEF1F6",
  listCancelledText: "#9D2450",
  // Solid raspberry LIVE pill with white text (14-v1.3 home contract).
  listLive: "#AD1B57",
  listGroupWash: "linear-gradient(110deg, #F2F5FF, #FFF7FB)",
  listLiveGroupBg: "#E9E3FF",

  // Concert-detail palette (approved packet 18-v3 color-v3.css). Page-
  // scoped like the list palette above; the CSS module carries the rest
  // of the page's pastels, these are the ones set from components.
  setlistTabActive: "#5B3CA1", // selected setlist/prediction chip, white text
  setlistTabIdleBg: "#F4F6FA",
  setlistTabIdleBorder: "#AAB8CF",
  reactionBorder: "#C1CBDA", // reaction button with a count
  reactionBorderEmpty: "#AAB8CF", // dashed, count 0
  impressionField: "#A79BBF", // 한줄감상 textarea border
  impressionCardBorder: "#DCD1EF", // other viewers' impression cards

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

  // Bonus-stat chip palette on the Album page InfoCard sidebar (b02
  // mockup-gap pass). Traffic-light semantic mapping picked literal
  // from raw/mockups/album-page-mockup.jsx (line 686-714):
  //   total  → primary blue (matches `primary` family but lifted out
  //            as its own token so a future album-stat palette tweak
  //            doesn't paint the rest of the brand)
  //   active → emerald green (positive availability cue, distinct
  //            from the wishlistMatch greens used elsewhere)
  //   ended  → slate gray (neutral past-state, matches the
  //            EndedListingToggle muted styling on the bonus tab)
  bonusTotalText: "#0277BD",
  bonusTotalBg: "#e8f4fd",
  bonusActiveText: "#16a34a",
  bonusActiveBg: "#f0fdf4",
  bonusEndedText: "#64748b",
  bonusEndedBg: "#f1f5f9",
} as const;

/*
 * Share-card theme switch. The card's palettes live with the card
 * (`ShareCardPreview.tsx`, approved packet 18-share-v1): the exported
 * image is its own surface, and keeping its colours out of the app
 * tokens means a site palette change can't repaint shared images.
 */
export type ShareCardTheme = "dark" | "light";

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
  /**
   * Floating-positioned overlays that escape ancestor `overflow:
   * hidden` via React portal — currently the `<SongSearch>` result
   * dropdown. Sits above sticky chrome but below modals so a
   * future picker rendered inside `<ShareCardModal>` etc. doesn't
   * end up on top of its host dialog.
   */
  dropdown: 100,
  /** Modal backdrop + dialog (Share Card, Flag dialogs). */
  modal: 200,
  /** Toast / snackbar / inline announcement above modals. */
  toast: 300,
  /**
   * Site header (and its menu dropdown, which lives in the header's
   * stacking context). Above page sticky chrome so a sticky sidebar in
   * the 1024–1099px band cannot paint over the open menu; below the
   * floating dropdown/modal layers.
   */
  header: 50,
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

/*
 * Search result accents from the approved 12-v1.2 design (ticket 13).
 * Inks are the readable foregrounds on the 03 pastel accent washes
 * (all ≥ 5.6:1 on their backgrounds); they are role accents, not artist
 * colours. Search-only for now — a page ticket that needs the same role
 * should reuse these rather than add near-duplicates.
 */
export const searchColors = {
  artistInk: "#80344F", // artist icon chip + initial avatar, on accentPink
  songInk: "#594392", // song icon chip, on accentLavender
  variantInk: "#58417D", // version chip text, on accentLavender
  baseChipBg: "#EEF3F9", // "base version" chip, with textSecondary
  dayChipBg: "#EDF3FF", // concert "Day.N" chip
  dayChipInk: "#2457A6",
  matchedInk: "#53527D", // "matched name" line
  errorBorder: "#DAA6B7", // error state panel
  errorBg: "#FFF9FB",
  errorInk: "#80344F", // error state icon, on accentPink
} as const;

export const shadows = {
  // 03 contract card shadow (navy-tinted, low alpha) and its hover lift.
  card: "0 5px 18px #233C6810",
  cardHover: "0 8px 24px #233C681B",
  nav: "0 1px 3px rgba(0,0,0,0.04)",
  // Heavier brand-color glow for the LIVE hero card on the home page.
  // Original brand blue (#0277BD, the pre-redesign primary — kept here
  // because the home LIVE hero has not been redesigned yet) at
  // a deeper alpha + larger blur for a "lifted off the page" feel.
  heroLive: "0 8px 32px rgba(2,119,189,0.25)",
  // Neutral lift used by small image thumbnails (album covers, etc.)
  // that sit inside larger cards. Less brand-tinted than `card` so a
  // thumbnail's shadow doesn't compete with its enclosing card's
  // shadow and the two cleanly nest.
  imageThumbnail: "0 2px 8px rgba(0,0,0,0.1)",
} as const;

export const radius = {
  // Card-radius scale, in ascending order. `card` is the regular size
  // (most surfaces); `cardSm` is the compact card variant; `cardLg` is
  // the hero treatment for surfaces that need more prominence than a
  // regular card.
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
  // Header-only threshold from the 03 contract: the full desktop header
  // (four links + search field + three native locale labels) needs
  // ~1100px. Page layouts (sidebars, grids) keep `desktop` (1024) — this
  // value moves only the Nav between its desktop and menu forms.
  nav: 1100,
} as const;

/*
 * Layout-scale constants. `navHeight` is the `<Nav>` header height per
 * width band (03 contract): mobile <700px = 64, tablet 700–1099 = 68,
 * desktop ≥1100 (`breakpoint.nav`) = 80. The header is NOT sticky (it
 * never was — the 02 baseline and the approved mockup both scroll it
 * away), so these are clearances for sticky sidebars and anchor
 * `scroll-margin-top`, which keep a header-sized gap. Mirrored by the
 * `--legal-anchor-offset` values in globals.css.
 */
export const layout = {
  navHeight: { mobile: 64, tablet: 68, desktop: 80 },
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
 * row-shaped surfaces) and the home ongoing card's LIVE capsule
 * (`CompactEventCard`). Both must agree on the keyframe + cadence so a
 * design tweak doesn't fall out of sync between surfaces.
 */
export const motion = {
  livePulse: "live-pulse 1.2s ease-in-out infinite",
} as const;

/*
 * Composite gradients beyond `colors.brandGradient` /
 * `colors.darkGradient`. `liveBanner` is the dark-navy ramp used by
 * the series-page LIVE banner — the `textPrimary` → deeper-navy
 * `#1e3a5f` arc (`colors.navyDeep`).
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
  // Pressed-state variant of `colors.brandGradient` used by
  // `<PrimaryButton>` (`src/components/ui/Button.tsx`). Material 700 →
  // 800 step — two shade steps deeper than the default brand ramp so
  // the press registers visibly under the scale-down transform
  // without going so dark the button reads as "disabled" mid-
  // interaction. Mockup:
  // `F:\work\vaults\opensetlist\raw\mockups\wishlist-button-polish-mockup.jsx`.
  brandGradientPressed: "linear-gradient(135deg, #0288d1, #01579b)",
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
