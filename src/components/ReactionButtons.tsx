"use client";

import { useState, useCallback, useEffect } from "react";
import { useTranslations } from "next-intl";
import { trackEvent } from "@/lib/analytics";
import { getAnonId } from "@/lib/anonId";
import { useMounted } from "@/hooks/useMounted";
import { REACTION_TYPES } from "@/lib/reactions";

const EMPTY_REACTIONS: Record<string, string> = {};

// Optimistic placeholder ID stored in `myReactions` while a POST is in
// flight. `!!myReactions[type]` is what drives `isActive`, so any truthy
// string works — we just need to flip the visual state immediately.
// Persisted localStorage value is only ever the real reactionId returned
// by the server, never this sentinel (see handleToggle).
const OPTIMISTIC_PENDING = "pending";

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

    const wasActive = !!myReactions[reactionType];
    // Snapshot at click time so rollback restores exactly the pre-click
    // state regardless of any concurrent setState calls during the
    // network roundtrip.
    const snapshotMyReactions = myReactions;
    const snapshotCounts = counts;

    // Optimistic in-memory update so the visual state (border, bg, opacity,
    // count) flips immediately on tap instead of after the network
    // roundtrip. localStorage persistence is deferred until the server
    // confirms — a mid-flight tab close + reload then leaves the user with
    // the *server* state on their next visit, no stranded "pending"
    // sentinel in localStorage.
    if (wasActive) {
      const next = { ...myReactions };
      delete next[reactionType];
      setMyReactions(next);
      setCounts((prev) => ({
        ...prev,
        [reactionType]: Math.max(0, (prev[reactionType] ?? 0) - 1),
      }));
    } else {
      setMyReactions({
        ...myReactions,
        [reactionType]: OPTIMISTIC_PENDING,
      });
      setCounts((prev) => ({
        ...prev,
        [reactionType]: (prev[reactionType] ?? 0) + 1,
      }));
    }

    try {
      if (wasActive) {
        const reactionId = snapshotMyReactions[reactionType];
        const res = await fetch("/api/reactions", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reactionId }),
        });
        if (res.ok) {
          const next = { ...snapshotMyReactions };
          delete next[reactionType];
          persistReactions(next);
        } else {
          setMyReactions(snapshotMyReactions);
          setCounts(snapshotCounts);
        }
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
        if (res.ok) {
          const { reactionId, counts: newCounts } = await res.json();
          const finalReactions = {
            ...snapshotMyReactions,
            [reactionType]: reactionId,
          };
          setMyReactions(finalReactions);
          persistReactions(finalReactions);
          setCounts(newCounts);
        } else {
          setMyReactions(snapshotMyReactions);
          setCounts(snapshotCounts);
        }
      }
    } catch {
      // Network error — roll back the optimistic update.
      setMyReactions(snapshotMyReactions);
      setCounts(snapshotCounts);
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="mt-1 flex flex-wrap gap-1.5">
      {REACTION_TYPES.map(({ type, emoji }) => {
        const isActive = !!myReactions[type];
        const count = counts[type] ?? 0;
        return (
          <ReactionButton
            key={type}
            emoji={emoji}
            count={count}
            isActive={isActive}
            isDisabled={loading !== null}
            title={t(type)}
            onToggle={() => handleToggle(type)}
          />
        );
      })}
    </div>
  );
}

interface ReactionButtonProps {
  emoji: string;
  count: number;
  isActive: boolean;
  isDisabled: boolean;
  title: string;
  onToggle: () => void;
}

function ReactionButton({
  emoji,
  count,
  isActive,
  isDisabled,
  title,
  onToggle,
}: ReactionButtonProps) {
  // emojiAnim drives the inline `animation` style on the emoji <span>.
  // We swap the value (not the key) so the <span> isn't re-mounted —
  // remounting causes a frame where two emoji elements are in the DOM
  // mid-animation (mockup §3-3 "do NOT remount the emoji span" note).
  const [emojiAnim, setEmojiAnim] = useState<
    "activate" | "deactivate" | null
  >(null);

  // animKey is the count-slide trigger. Initial render starts at 0 with
  // animation disabled; each subsequent count change increments the key,
  // which both re-mounts the count <span> and lets the CSS animation
  // fire. Tracking via prev-count prop diff (instead of incrementing on
  // click) means polling-driven count changes also animate, matching the
  // verification spec (counts update from local tap AND polled aggregate).
  const [animKey, setAnimKey] = useState(0);
  const [prevCount, setPrevCount] = useState(count);
  if (prevCount !== count) {
    setPrevCount(count);
    setAnimKey((k) => k + 1);
  }

  // Reset emojiAnim 400ms after start so the next tap can re-trigger.
  // Effect cleanup also covers the toggle-on-then-toggle-off-quickly
  // case (state changes from "activate" to "deactivate" within 400ms,
  // canceling the pending reset).
  useEffect(() => {
    if (emojiAnim === null) return;
    const timer = setTimeout(() => setEmojiAnim(null), 400);
    return () => clearTimeout(timer);
  }, [emojiAnim]);

  const handleClick = () => {
    setEmojiAnim(isActive ? "deactivate" : "activate");
    onToggle();
  };

  const hasAny = count > 0;
  const emojiAnimation =
    emojiAnim === "activate"
      ? "emoji-activate 0.35s cubic-bezier(0.36, 0.07, 0.19, 0.97)"
      : emojiAnim === "deactivate"
        ? "emoji-deactivate 0.3s ease"
        : undefined;

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isDisabled}
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        borderRadius: 20,
        padding: "4px 10px",
        border: isActive
          ? "1.5px solid #0277BD"
          : hasAny
            ? "1.5px solid #e2e8f0"
            : "1.5px dashed #d1d5db",
        background: isActive ? "#e8f4fd" : "white",
        cursor: isDisabled ? "default" : "pointer",
        opacity: isActive || hasAny ? 1 : 0.4,
        transition:
          "background 0.18s ease, border-color 0.18s ease, opacity 0.18s ease, transform 0.07s ease",
        WebkitTapHighlightColor: "transparent",
        outline: "none",
      }}
      className="active:scale-[0.91]"
    >
      <span
        style={{
          fontSize: 15,
          lineHeight: 1,
          display: "inline-block",
          animation: emojiAnimation,
        }}
      >
        {emoji}
      </span>
      {count > 0 && (
        <span
          key={animKey}
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: isActive ? "#0277BD" : "#475569",
            minWidth: 14,
            display: "inline-block",
            transition: "color 0.18s ease",
            animation: animKey > 0 ? "count-slide 0.22s ease" : undefined,
          }}
        >
          {count}
        </span>
      )}
    </button>
  );
}
