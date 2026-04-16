"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";

const REACTIONS = [
  { type: "waiting", emoji: "😭" },
  { type: "best", emoji: "🔥" },
  { type: "surprise", emoji: "😱" },
  { type: "moved", emoji: "🩷" },
] as const;

interface Props {
  setlistItemId: string;
  initialCounts: Record<string, number>;
}

export function ReactionButtons({ setlistItemId, initialCounts }: Props) {
  const t = useTranslations("Reaction");
  const [counts, setCounts] = useState(initialCounts);
  const [myReactions, setMyReactions] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState<string | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem(`reactions-${setlistItemId}`);
    if (saved) {
      try {
        setMyReactions(JSON.parse(saved));
      } catch {
        // ignore corrupt data
      }
    }
  }, [setlistItemId]);

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
        await fetch("/api/reactions", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reactionId: existingId }),
        });
        const next = { ...myReactions };
        delete next[reactionType];
        setMyReactions(next);
        persistReactions(next);
        setCounts((prev) => ({
          ...prev,
          [reactionType]: Math.max(0, (prev[reactionType] ?? 0) - 1),
        }));
      } else {
        const res = await fetch("/api/reactions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ setlistItemId, reactionType }),
        });
        const { reactionId, counts: newCounts } = await res.json();
        const next = { ...myReactions, [reactionType]: reactionId };
        setMyReactions(next);
        persistReactions(next);
        setCounts(newCounts);
      }
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
            disabled={loading === type}
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
