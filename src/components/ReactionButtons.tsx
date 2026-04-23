"use client";

import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { trackEvent } from "@/lib/analytics";
import { getAnonId } from "@/lib/anonId";

const REACTIONS = [
  { type: "waiting", emoji: "😭" },
  { type: "best", emoji: "🔥" },
  { type: "surprise", emoji: "😱" },
  { type: "moved", emoji: "🩷" },
] as const;

function readMyReactions(setlistItemId: string): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(`reactions-${setlistItemId}`);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
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
  const [counts, setCounts] = useState(initialCounts);
  const [myReactions, setMyReactions] = useState<Record<string, string>>(() =>
    readMyReactions(setlistItemId)
  );
  const [loading, setLoading] = useState<string | null>(null);

  // Re-hydrate from localStorage on setlistItemId change without an effect.
  // The useState-pair pattern (track previous prop in state, not a ref) is
  // the React docs' "Storing information from previous renders" idiom —
  // setState during render is allowed and react-hooks/refs is happy
  // because we never read or write a ref in the render body.
  const [prevSetlistItemId, setPrevSetlistItemId] = useState(setlistItemId);
  if (prevSetlistItemId !== setlistItemId) {
    setPrevSetlistItemId(setlistItemId);
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
      {REACTIONS.map(({ type, emoji }) => {
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
