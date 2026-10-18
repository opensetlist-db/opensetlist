import { colors } from "@/styles/tokens";

/**
 * `<ReactionButtons>` active-state palette (mockup §3-3). Pulled from
 * the shared design tokens so the brand-blue stays in lockstep with the
 * rest of the chrome; named per reaction so tests can assert against
 * the same source of truth without importing tokens directly.
 *
 * A plain module: the "use client" component that uses it may export
 * only components and hooks (`local/use-client-exports`).
 */
export const REACTION_ACTIVE_COLOR = colors.primary;
export const REACTION_ACTIVE_BG = colors.primaryBg;
