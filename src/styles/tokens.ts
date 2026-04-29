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

  // Error feedback (validation + submission failures). Same red as `live`
  // today, but semantically distinct: a future brand shift moving live to
  // orange (rare but possible per CR) shouldn't recolor error text. Keep
  // both hexes here so the divergence is one-line easy if it happens.
  error: "#dc2626",

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

  // Song-variant / encore divider accent
  variant: "#7B1FA2",
  variantBg: "#F3E5F5",
} as const;

/*
 * Fallback palette for unit-type artists whose `Artist.color` hasn't
 * been backfilled yet. Picked to read as distinct hues at small pill
 * sizes while staying out of the semantic color territory:
 *   - no pure red (collides with `live`), green (`upcoming`), or
 *     `colors.primary` blue
 *   - mid saturation — readable both as a background tint at ~12%
 *     alpha (`${color}18`) and as foreground text at full opacity
 *   - 17 entries — empirically the smallest palette size at which
 *     the FNV-1a + Murmur3-fmix hash in
 *     `src/lib/artistColor.ts#hashUnitSlug` distributes the nine
 *     Hasunosora sub-unit slugs onto distinct buckets. Smaller
 *     palettes (10, 12, 16) collapse 2–4 pairs because the hash's
 *     mod-N output isn't uniform on short ASCII slugs. Bigger
 *     palettes are fine but waste curated entries.
 *
 * Indexed by a stable hash of the unit's slug (see
 * `src/lib/artistColor.ts#resolveUnitColor`). DO NOT reorder
 * existing entries — order changes shift every unit's auto-color
 * until operators backfill explicit values, which would look like a
 * surprise re-skin to anyone watching.
 */
export const unitFallbackPalette = [
  "#E91E8C", // 0 rose
  "#F57C00", // 1 orange
  "#7B1FA2", // 2 royal purple
  "#00897B", // 3 teal
  "#FBC02D", // 4 amber gold
  "#3949AB", // 5 indigo
  "#C2185B", // 6 magenta
  "#5D4037", // 7 warm brown
  "#827717", // 8 olive
  "#00ACC1", // 9 cyan
  "#FF6F00", // 10 deep orange
  "#512DA8", // 11 deep purple
  "#006064", // 12 deep teal
  "#AD1457", // 13 deep pink
  "#9E9D24", // 14 lime-olive
  "#BF360C", // 15 rust
  "#455A64", // 16 slate
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
