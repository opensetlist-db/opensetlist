"use client";

import { useState, useCallback, useEffect } from "react";
import { useTranslations } from "next-intl";
import { trackEvent } from "@/lib/analytics";
import { getAnonId } from "@/lib/anonId";
import { useMounted } from "@/hooks/useMounted";
import { REACTION_TYPES } from "@/lib/reactions";
import { colors, radius } from "@/styles/tokens";

const EMPTY_REACTIONS: Record<string, string> = {};

// Optimistic placeholder ID stored in `myReactions` while a POST is in
// flight. `!!myReactions[type]` is what drives `isActive`, so any truthy
// string works — we just need to flip the visual state immediately.
// Persisted localStorage value is only ever the real reactionId returned
// by the server, never this sentinel (see handleToggle).
const OPTIMISTIC_PENDING = "pending";

// Hard ceiling on a single mutation request. If the server hangs for
// longer than this, the AbortSignal fires, fetch throws, and the catch
// block rolls back the optimistic update + clears `loading`. Without
// this ceiling, a single hung request would leave all four reaction
// buttons disabled until the user navigates away.
const REACTION_TIMEOUT_MS = 10_000;

// Three-state palette (mockup §3-3). Active state pulls from the
// shared design tokens so the brand-blue stays in lockstep with the
// rest of the chrome. Re-exported under reaction-scoped names so
// tests can assert against the same source of truth without
// importing tokens directly.
export const REACTION_ACTIVE_COLOR = colors.primary;
export const REACTION_ACTIVE_BG = colors.primaryBg;
const REACTION_BORDER_SOLID = colors.border;
const REACTION_BORDER_DASHED = colors.borderDashed;
const REACTION_COUNT_INACTIVE_COLOR = colors.textSecondary;

// Mirrors the durations in globals.css `@keyframes emoji-activate` /
// `@keyframes emoji-deactivate` / `@keyframes count-slide`. Source of
// truth for the inline animation strings AND the post-animation reset
// timer below — keep them in lockstep.
const EMOJI_ACTIVATE_DURATION_MS = 350;
const EMOJI_DEACTIVATE_DURATION_MS = 300;
const COUNT_SLIDE_DURATION_MS = 220;

// Reset window so the next tap can re-trigger; 50ms safety margin past
// whichever animation runs longer. Derives from the durations above so a
// future keyframe change auto-extends the buffer.
const EMOJI_ANIM_RESET_MS =
  Math.max(EMOJI_ACTIVATE_DURATION_MS, EMOJI_DEACTIVATE_DURATION_MS) + 50;

// Runtime guard for POST /api/reactions success responses. Server is
// expected to return `{ reactionId: string; counts: Record<string,
// number> }`. Used to fail closed (rollback) on any unexpected shape
// rather than write garbage into local state.
function isReactionPostResponse(
  value: unknown,
): value is { reactionId: string; counts: Record<string, number> } {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  // Reject empty strings too — `myReactions[type] = ""` would make
  // `!!myReactions[type]` false, silently dropping the active state
  // and persisting a bogus empty ID to localStorage.
  if (typeof v.reactionId !== "string" || v.reactionId.length === 0) {
    return false;
  }
  if (!v.counts || typeof v.counts !== "object" || Array.isArray(v.counts)) {
    return false;
  }
  // Tighter than `typeof n === "number"` — NaN, Infinity, negatives and
  // decimals shouldn't ever land in `setCounts(data.counts)` and would
  // produce corrupted UI (negative count badges, NaN labels).
  return Object.values(v.counts).every(
    (n) =>
      typeof n === "number" &&
      Number.isFinite(n) &&
      Number.isInteger(n) &&
      n >= 0,
  );
}

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
  const [loading, setLoading] = useState<string | null>(null);

  // Re-sync `counts` when the parent passes a fresh `initialCounts`
  // reference (the 5s polling refresh produces a new map every tick).
  // useState idiom from React docs ("Storing information from previous
  // renders") — avoids react-hooks/set-state-in-effect. Callers must
  // stabilize empty references so this guard doesn't thrash on items
  // with zero reactions; LiveSetlist hoists EMPTY_COUNTS for that.
  //
  // Skip the live sync while a mutation is in flight: a polling tick
  // mid-roundtrip would clobber the optimistic count, and on rollback
  // we'd restore to a snapshot taken *before* the polling update —
  // legitimate concurrent reactions from other users would disappear
  // for one cycle. But we DO need to remember the latest polled
  // value so we can apply it when loading clears, otherwise the
  // pending update is lost permanently (the next polling tick will
  // pass the same `initialCounts` reference, the equality check
  // below stays false, and the polled change never propagates).
  // Stash into `pendingPollCounts`; the prev-loading transition
  // block below drains it once `loading` returns to null. The
  // mutation success path (POST) also clears the stash since the
  // server's `data.counts` response is the authoritative state for
  // *this* setlist item at the moment of the click + the polled
  // snapshot is, by definition, no fresher.
  const [pendingPollCounts, setPendingPollCounts] = useState<
    Record<string, number> | null
  >(null);
  const [prevInitialCounts, setPrevInitialCounts] = useState(initialCounts);
  if (prevInitialCounts !== initialCounts) {
    setPrevInitialCounts(initialCounts);
    if (loading === null) {
      setCounts(initialCounts);
      // Clear any stash from a previous in-flight window so the
      // prev-loading transition block below — which can fire in the
      // same render cycle when `loading` *also* transitioned to null
      // — can't overwrite the fresher `initialCounts` we just
      // applied with a stale polled snapshot. React applies the
      // last setter call in a render, so without this guard the
      // ordering of the two blocks would otherwise determine
      // truth.
      setPendingPollCounts(null);
    } else {
      setPendingPollCounts(initialCounts);
    }
  }
  // When `loading` transitions from a reaction-type back to null
  // (mutation settled — success, failure, or rollback), apply any
  // polling update that landed during the in-flight window. Mutation
  // POST-success paths clear `pendingPollCounts` themselves before
  // `loading` flips, so this block is a no-op in that case.
  const [prevLoading, setPrevLoading] = useState(loading);
  if (prevLoading !== loading) {
    setPrevLoading(loading);
    if (loading === null && pendingPollCounts !== null) {
      setCounts(pendingPollCounts);
      setPendingPollCounts(null);
    }
  }
  // SSR + client first render both start at EMPTY_REACTIONS so hydration
  // matches; the `mounted && hydratedKey !== setlistItemId` block below
  // pulls the real localStorage value on the first commit AFTER mount.
  const [myReactions, setMyReactions] = useState<Record<string, string>>(
    EMPTY_REACTIONS
  );

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
          // Bound the request so a hung connection can't permanently
          // disable all four buttons (loading is only cleared in
          // `finally`, so a never-settling Promise leaves them locked).
          signal: AbortSignal.timeout(REACTION_TIMEOUT_MS),
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
          signal: AbortSignal.timeout(REACTION_TIMEOUT_MS),
        });
        if (res.ok) {
          // Validate response shape before destructuring. Server is
          // expected to return `{ reactionId: string, counts: Record<string,
          // number> }`, but a deploy desync, proxy injection, or schema
          // change could deliver an unexpected payload — destructuring
          // blindly would write `undefined` into `myReactions[type]` and
          // call `setCounts(undefined)`, crashing the next render.
          const data: unknown = await res.json();
          if (!isReactionPostResponse(data)) {
            setMyReactions(snapshotMyReactions);
            setCounts(snapshotCounts);
          } else {
            const finalReactions = {
              ...snapshotMyReactions,
              [reactionType]: data.reactionId,
            };
            setMyReactions(finalReactions);
            persistReactions(finalReactions);
            setCounts(data.counts);
            // Server's response is the authoritative count for this
            // setlist item — discard any polled value stashed during
            // the in-flight window so the prev-loading transition
            // doesn't overwrite this fresher state with a stale
            // polling snapshot.
            setPendingPollCounts(null);
          }
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
    const timer = setTimeout(() => setEmojiAnim(null), EMOJI_ANIM_RESET_MS);
    return () => clearTimeout(timer);
  }, [emojiAnim]);

  const handleClick = () => {
    setEmojiAnim(isActive ? "deactivate" : "activate");
    onToggle();
  };

  const hasAny = count > 0;
  const emojiAnimation =
    emojiAnim === "activate"
      ? `emoji-activate ${EMOJI_ACTIVATE_DURATION_MS / 1000}s cubic-bezier(0.36, 0.07, 0.19, 0.97)`
      : emojiAnim === "deactivate"
        ? `emoji-deactivate ${EMOJI_DEACTIVATE_DURATION_MS / 1000}s ease`
        : undefined;

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isDisabled}
      title={title}
      aria-label={title}
      aria-pressed={isActive}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        borderRadius: radius.button,
        padding: "4px 10px",
        border: isActive
          ? `1.5px solid ${REACTION_ACTIVE_COLOR}`
          : hasAny
            ? `1.5px solid ${REACTION_BORDER_SOLID}`
            : `1.5px dashed ${REACTION_BORDER_DASHED}`,
        background: isActive ? REACTION_ACTIVE_BG : "white",
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
      {/* Always render the count slot so every reaction button
          across every setlist row has the same width regardless of
          the count value (no count → empty string, the slot still
          reserves space). `tabular-nums` keeps individual digit
          widths equal across 0-9, and right-align pins the rightmost
          digit to the same x in every button — the visually salient
          anchor when a column of counts is meant to read like a
          leaderboard. `minWidth: 18` fits two digits cleanly inside
          the 280px setlist reactions column (each button is
          ~63–65px on Windows / Segoe UI Emoji where emoji glyphs
          render wider than macOS Apple Color Emoji; 4 × 65 + 3 ×
          6px gaps ≅ 278px, with a small buffer in the column).
          Going wider here (e.g. 22 to fit three digits) re-introduces
          the wrap onto a second line. Three-digit counts will stretch
          their own button by a few px and visibly drift in that one
          row, which is acceptable for the rare case at Phase 1A
          scale — column-fit beats absolute alignment when push comes
          to shove. See `setlistLayout.ts` for the 260 → 280 history. */}
      <span
        key={animKey}
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: isActive ? REACTION_ACTIVE_COLOR : REACTION_COUNT_INACTIVE_COLOR,
          minWidth: 18,
          display: "inline-block",
          textAlign: "right",
          fontVariantNumeric: "tabular-nums",
          transition: "color 0.18s ease",
          animation:
            animKey > 0
              ? `count-slide ${COUNT_SLIDE_DURATION_MS / 1000}s ease`
              : undefined,
        }}
      >
        {count > 0 ? count : ""}
      </span>
    </button>
  );
}
