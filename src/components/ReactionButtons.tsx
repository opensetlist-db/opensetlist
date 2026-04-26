"use client";

import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { trackEvent } from "@/lib/analytics";
import { getAnonId } from "@/lib/anonId";
import { useMounted } from "@/hooks/useMounted";
import { REACTION_TYPES } from "@/lib/reactions";

const EMPTY_REACTIONS: Record<string, string> = {};

function readMyReactions(setlistItemId: string): Record<string, string> {
  if (typeof window === "undefined") return EMPTY_REACTIONS;
  try {
    const raw = localStorage.getItem(`reactions-${setlistItemId}`);
    if (!raw) return EMPTY_REACTIONS;
    const parsed: unknown = JSON.parse(raw);
    // Defensive shape check — localStorage can be tampered with (DevTools,
    // browser extensions, JSON.parse("null") returning null, etc.). Spread
    // on a non-object would either silently misbehave or throw at the
    // myReactions[type] access site.
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return EMPTY_REACTIONS;
    }
    return Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => typeof value === "string")
    ) as Record<string, string>;
  } catch {
    return EMPTY_REACTIONS;
  }
}

interface Props {
  setlistItemId: string;
  songId: string;
  eventId: string;
  initialCounts: Record<string, number>;
}

export function ReactionButtons({
  setlistItemId,
  songId,
  eventId,
  initialCounts,
}: Props) {
  const t = useTranslations("Reaction");
  const mounted = useMounted();
  const [counts, setCounts] = useState(initialCounts);
  // Re-sync `counts` when the parent passes a fresh `initialCounts`
  // reference (the 5s polling refresh produces a new map every tick).
  // useState idiom from React docs ("Storing information from previous
  // renders") — avoids react-hooks/set-state-in-effect. Callers must
  // stabilize empty references so this guard doesn't thrash on items
  // with zero reactions; LiveSetlist hoists EMPTY_COUNTS for that.
  const [prevInitialCounts, setPrevInitialCounts] = useState(initialCounts);
  if (prevInitialCounts !== initialCounts) {
    setPrevInitialCounts(initialCounts);
    setCounts(initialCounts);
  }
  // SSR + client first render both start at EMPTY_REACTIONS so hydration
  // matches; the `mounted && hydratedKey !== setlistItemId` block below
  // pulls the real localStorage value on the first commit AFTER mount.
  const [myReactions, setMyReactions] = useState<Record<string, string>>(
    EMPTY_REACTIONS
  );
  const [loading, setLoading] = useState<string | null>(null);

  // Hydrate (or re-hydrate on setlistItemId change) AFTER mount. Tracking
  // hydratedKey in useState avoids both react-hooks/set-state-in-effect
  // (no useEffect) and react-hooks/refs (no ref access in render).
  const [hydratedKey, setHydratedKey] = useState<string | null>(null);
  if (mounted && hydratedKey !== setlistItemId) {
    setHydratedKey(setlistItemId);
    setMyReactions(readMyReactions(setlistItemId));
  }

  const persistReactions = useCallback(
    (reactions: Record<string, string>) => {
      localStorage.setItem(
        `reactions-${setlistItemId}`,
        JSON.stringify(reactions)
      );
    },
    [setlistItemId]
  );

  const handleToggle = async (reactionType: string) => {
    if (loading) return;
    setLoading(reactionType);

    try {
      const existingId = myReactions[reactionType];

      if (existingId) {
        const res = await fetch("/api/reactions", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reactionId: existingId }),
        });
        if (!res.ok) return;
        const next = { ...myReactions };
        delete next[reactionType];
        setMyReactions(next);
        persistReactions(next);
        setCounts((prev) => ({
          ...prev,
          [reactionType]: Math.max(0, (prev[reactionType] ?? 0) - 1),
        }));
      } else {
        if (songId) {
          trackEvent("emotion_tag_click", {
            reaction_type: reactionType,
            song_id: songId,
            event_id: eventId,
          });
        }
        const res = await fetch("/api/reactions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            setlistItemId,
            reactionType,
            anonId: getAnonId(),
          }),
        });
        if (!res.ok) return;
        const { reactionId, counts: newCounts } = await res.json();
        const next = { ...myReactions, [reactionType]: reactionId };
        setMyReactions(next);
        persistReactions(next);
        setCounts(newCounts);
      }
    } catch {
      // Network error — silently ignore
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="mt-1 flex gap-1">
      {REACTION_TYPES.map(({ type, emoji }) => {
        const isActive = !!myReactions[type];
        const count = counts[type] ?? 0;
        return (
          <button
            key={type}
            type="button"
            onClick={() => handleToggle(type)}
            disabled={loading !== null}
            className={`rounded-full px-2 py-0.5 text-xs transition-opacity ${
              isActive
                ? "bg-zinc-100 opacity-100"
                : "opacity-40 hover:opacity-70"
            }`}
            title={t(type)}
          >
            {emoji}
            {count > 0 && (
              <span className="ml-0.5 text-zinc-600">{count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
