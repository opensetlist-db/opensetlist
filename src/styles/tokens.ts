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

  // Backgrounds
  bgPage: "#f0f4f8",
  bgCard: "#ffffff",
  bgSubtle: "#f8fafc",
  bgFaint: "#fafbfc",

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
  errorBg: "#fef2f2",
  errorBorder: "#fecaca",
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
  avatar: 14,
} as const;

export const breakpoint = {
  desktop: 1024,
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
