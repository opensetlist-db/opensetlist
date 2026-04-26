// Single source of truth for the reaction types displayed in the UI and
// their emojis. The four types here mirror the `ReactionType` Prisma enum
// (waiting | best | surprise | moved); keep this list in sync with the
// schema if a new value is ever added.
export const REACTION_TYPES = [
  { type: "waiting", emoji: "😭" },
  { type: "best", emoji: "🔥" },
  { type: "surprise", emoji: "😱" },
  { type: "moved", emoji: "🩷" },
] as const;

// Lookup-by-key view of REACTION_TYPES. Typed as Record<string, string>
// (not the strict literal union) because callers index it with a
// reactionType string that may come from server data (Prisma enum) — the
// `?? ""` fallback at call sites covers any future-added types we haven't
// emoji-mapped yet.
export const EMOJI_MAP: Record<string, string> = Object.fromEntries(
  REACTION_TYPES.map((r) => [r.type, r.emoji]),
);
