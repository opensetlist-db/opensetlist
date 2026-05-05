"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { SongSearch, type SongSearchResult } from "@/components/SongSearch";
import { SongMatchBadge } from "@/components/SongMatchBadge";
import { displayOriginalTitle } from "@/lib/display";
import { useMounted } from "@/hooks/useMounted";
import { readWishes, writeWishes, type WishEntry } from "@/lib/wishStorage";
import type { FanTop3Entry } from "@/lib/types/setlist";
import type { SongMatchInputItem } from "@/lib/songMatch";
import { colors } from "@/styles/tokens";

const MEDALS = ["🥇", "🥈", "🥉"];
const MAX_WISHES = 3;

interface Props {
  eventId: string;
  locale: string;
  /**
   * Event start time in UTC. Per CLAUDE.md the comparison `now <
   * startTime` is correct because both sides are absolute instants —
   * we never bucket on local-time day boundaries here.
   * `Date | string` because `serializeBigInt` on the page produces a
   * string for date columns; the constructor coerces either input.
   */
  startTime: Date | string;
  /** Polled actual setlist — drives match-highlights in locked state. */
  setlistItems: SongMatchInputItem[];
  /** Polled fan TOP-3 (server aggregate). */
  top3Wishes: FanTop3Entry[];
}

export function EventWishSection({
  eventId,
  locale,
  startTime,
  setlistItems,
  top3Wishes,
}: Props) {
  const t = useTranslations("Wishlist");
  const mounted = useMounted();

  // Lock state strategy:
  //   - Lazy useState initializer reads `Date.now()` ONCE at mount —
  //     not on every render — so initial paint for an already-past
  //     event renders the locked UI directly (no flash of pre-show
  //     affordances). Lazy init runs in mount phase, not render
  //     phase, so it sidesteps `react-hooks/purity`.
  //   - useEffect schedules a one-shot setTimeout exactly at the
  //     `startTime` boundary so the flip happens reliably even if
  //     the parent never re-renders between SSR and the lock instant.
  //     Setting state from a setTimeout callback is fine for
  //     `react-hooks/set-state-in-effect` (the rule targets
  //     synchronous-in-effect, not async-callback-in-effect).
  // CLAUDE.md UTC rule: both `Date.now()` and the `Date(startTime)`
  // constructor return absolute instants — comparison is
  // region-independent.
  const startMs =
    startTime instanceof Date ? startTime.getTime() : new Date(startTime).getTime();
  const [isLocked, setIsLocked] = useState(() => Date.now() >= startMs);
  useEffect(() => {
    if (isLocked) return;
    const remaining = startMs - Date.now();
    if (remaining <= 0) return; // lazy init already set true
    const timer = setTimeout(() => setIsLocked(true), remaining);
    return () => clearTimeout(timer);
  }, [isLocked, startMs]);

  // Hydrate localStorage AFTER mount so SSR + first client render
  // both produce the same HTML. INTENTIONAL — mirrors the
  // `<ReactionButtons>` pattern at src/components/ReactionButtons.tsx:184-191
  // (mounted-gate + render-time `setState`). NOT a useEffect: the
  // `useMounted` hook's docstring (src/hooks/useMounted.ts:9-18)
  // explicitly calls this the "canonical React 18+ replacement"
  // for the useState+useEffect mount pattern, which trips
  // `react-hooks/set-state-in-effect`. Code reviewers (CodeRabbit
  // / commit-time hook) sometimes flag this as a hydration
  // violation — it is not, see the precedent.
  const [myWishes, setMyWishes] = useState<WishEntry[]>([]);
  const [hydratedKey, setHydratedKey] = useState<string | null>(null);
  if (mounted && hydratedKey !== eventId) {
    setHydratedKey(eventId);
    setMyWishes(readWishes(eventId));
  }

  const [searchOpen, setSearchOpen] = useState(false);
  const [pending, setPending] = useState(false);

  const handleSelect = useCallback(
    async (song: SongSearchResult) => {
      if (pending) return;
      // Guard against double-add of the same song — localStorage owns
      // dedup at 1B/1C, so we enforce here before POST.
      if (myWishes.some((w) => w.songId === song.id)) {
        setSearchOpen(false);
        return;
      }
      if (myWishes.length >= MAX_WISHES) {
        setSearchOpen(false);
        return;
      }
      setPending(true);
      const snapshot = myWishes;
      // Optimistic add with sentinel dbId — replaced on POST success.
      const optimistic: WishEntry = {
        songId: song.id,
        dbId: "__pending__",
        song: {
          originalTitle: song.originalTitle,
          originalLanguage: song.originalLanguage,
          variantLabel: song.variantLabel,
          baseVersionId: song.baseVersionId,
          translations: song.translations,
        },
      };
      setMyWishes([...snapshot, optimistic]);
      setSearchOpen(false);
      try {
        const res = await fetch(`/api/events/${eventId}/wishes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ songId: song.id }),
        });
        if (!res.ok) throw new Error(`POST failed: ${res.status}`);
        const data = (await res.json()) as { id: string; songId: number };
        // Replace sentinel with the real id, then persist. Persisting
        // only on confirmed success means a mid-flight tab close
        // leaves localStorage clean — no stranded `__pending__` rows.
        // `writeWishes` swallows quota / private-mode errors
        // internally (src/lib/wishStorage.ts:118-128), so no
        // try/catch needed at this call site — by design.
        const next: WishEntry[] = [
          ...snapshot,
          { ...optimistic, dbId: data.id },
        ];
        setMyWishes(next);
        writeWishes(eventId, next);
      } catch {
        // Rollback. Optimistic UI flips back to the snapshot; nothing
        // persisted to localStorage so refresh would also show the
        // pre-add state.
        setMyWishes(snapshot);
      } finally {
        setPending(false);
      }
    },
    [eventId, myWishes, pending],
  );

  const handleRemove = useCallback(
    async (entry: WishEntry) => {
      if (pending) return;
      // Sentinel-id rows never made it to the server — strip
      // locally without a DELETE call.
      if (entry.dbId === "__pending__") return;
      setPending(true);
      const snapshot = myWishes;
      const next = snapshot.filter((w) => w.dbId !== entry.dbId);
      setMyWishes(next);
      // `writeWishes` swallows quota / private-mode errors internally
      // (src/lib/wishStorage.ts:118-128) — no try/catch needed here
      // or in the rollback below. Same convention used throughout.
      writeWishes(eventId, next);
      try {
        const res = await fetch(
          `/api/events/${eventId}/wishes/${encodeURIComponent(entry.dbId)}`,
          { method: "DELETE" },
        );
        if (!res.ok) throw new Error(`DELETE failed: ${res.status}`);
      } catch {
        setMyWishes(snapshot);
        writeWishes(eventId, snapshot);
      } finally {
        setPending(false);
      }
    },
    [eventId, myWishes, pending],
  );

  // Render-mode gate: locked + no data → render nothing. This is
  // checked AFTER hydration so the SSR pass (which sees myWishes=[])
  // doesn't return null and create a hydration mismatch when the
  // client read from localStorage adds rows. SSR always renders the
  // section structurally; only post-hydration locked-with-zero-data
  // collapses it.
  if (mounted && isLocked && top3Wishes.length === 0 && myWishes.length === 0) {
    return null;
  }

  const excludeSongIds = myWishes.map((w) => w.songId);
  const canAddMore = !isLocked && myWishes.length < MAX_WISHES;
  const titleText = isLocked ? t("lockedTitle") : t("title");

  return (
    <section
      className="mb-2.5 overflow-hidden rounded-[14px]"
      style={{
        background: colors.wishlistBg,
        border: `0.5px solid ${colors.wishlistBorder}`,
      }}
    >
      {/* Title bar: 🌸 + label, with `최대 3곡` hint right-aligned in
          pre-show only. */}
      <div
        className="flex items-center justify-between px-3.5 pt-2.5 pb-2"
        style={{ borderBottom: `0.5px solid ${colors.wishlistBorder}` }}
      >
        <span
          className="text-[13px] font-medium"
          style={{ color: colors.wishlistText }}
        >
          🌸 {titleText}
        </span>
        {!isLocked && (
          <span
            className="text-[11px]"
            style={{ color: colors.wishlistMuted }}
          >
            {t("cap")}
          </span>
        )}
      </div>

      <div className="px-3.5 py-2.5">
        <div className="grid grid-cols-2 gap-2.5 lg:gap-4">
          {/* 내 선택 */}
          <div>
            <div
              className="text-[10px] font-medium uppercase tracking-wider mb-1.5"
              style={{ color: colors.textMuted }}
            >
              {t("myList")}
            </div>
            {myWishes.map((entry, i) => {
              const display = displayOriginalTitle(
                {
                  originalTitle: entry.song.originalTitle,
                  originalLanguage: entry.song.originalLanguage,
                  variantLabel: entry.song.variantLabel,
                },
                entry.song.translations,
                locale,
              );
              return (
                <div
                  key={entry.dbId === "__pending__" ? `pending-${entry.songId}` : entry.dbId}
                  className="flex items-center gap-1.5 py-1"
                  style={{
                    borderBottom:
                      i < myWishes.length - 1
                        ? `0.5px solid ${colors.wishlistRowDivider}`
                        : "none",
                  }}
                >
                  {!isLocked && (
                    <button
                      type="button"
                      onClick={() => handleRemove(entry)}
                      disabled={pending}
                      aria-label={t("removeAria")}
                      className="flex-shrink-0 inline-flex items-center justify-center rounded-full"
                      style={{
                        width: 15,
                        height: 15,
                        background: colors.wishlistRowDivider,
                        color: colors.wishlistMuted,
                        fontSize: 9,
                        cursor: pending ? "not-allowed" : "pointer",
                      }}
                    >
                      ✕
                    </button>
                  )}
                  <span
                    className="flex-1 text-xs truncate"
                    style={{ color: colors.textPrimary }}
                  >
                    {display.main}
                    {display.sub && (
                      <span
                        className="ml-1 text-[11px]"
                        style={{ color: colors.textMuted }}
                      >
                        {display.sub}
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
            {canAddMore && (
              <div className="pt-1">
                {searchOpen ? (
                  <div>
                    <SongSearch
                      onSelect={handleSelect}
                      locale={locale}
                      texts={{
                        placeholder: t("searchPlaceholder"),
                        loading: t("searchLoading"),
                        noResults: t("searchNoResults"),
                      }}
                      excludeSongIds={excludeSongIds}
                      variant="compact"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => setSearchOpen(false)}
                      className="mt-1 text-[11px]"
                      style={{ color: colors.textMuted }}
                    >
                      {t("cancel")}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setSearchOpen(true)}
                    className="text-xs"
                    style={{ color: colors.wishlistMuted, cursor: "pointer" }}
                  >
                    {t("add")}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* 팬 TOP3 */}
          <div>
            <div
              className="text-[10px] font-medium uppercase tracking-wider mb-1.5"
              style={{ color: colors.textMuted }}
            >
              {t("fanTop3")}
            </div>
            {top3Wishes.map((entry, i) => {
              const display = displayOriginalTitle(
                {
                  originalTitle: entry.song.originalTitle,
                  originalLanguage: entry.song.originalLanguage,
                  variantLabel: entry.song.variantLabel,
                },
                entry.song.translations,
                locale,
              );
              return (
                <div
                  key={entry.song.id}
                  className="flex items-center gap-1.5 py-1"
                  style={{
                    borderBottom:
                      i < top3Wishes.length - 1
                        ? `0.5px solid ${colors.wishlistRowDivider}`
                        : "none",
                  }}
                >
                  <span className="flex-shrink-0 text-[13px]">
                    {MEDALS[i] ?? ""}
                  </span>
                  <span className="flex-1 text-xs truncate min-w-0">
                    <SongMatchBadge
                      songId={entry.song.id}
                      setlistItems={setlistItems}
                      // Pre-show: no actual setlist yet, suppress
                      // the highlight even if a wish happens to
                      // match an admin-typed placeholder.
                      disabled={!isLocked}
                    >
                      <span style={{ color: colors.textPrimary }}>
                        {display.main}
                      </span>
                    </SongMatchBadge>
                    {display.sub && (
                      <span
                        className="ml-1 text-[11px]"
                        style={{ color: colors.textMuted }}
                      >
                        {display.sub}
                      </span>
                    )}
                  </span>
                  <span
                    className="flex-shrink-0 text-[11px]"
                    style={{ color: colors.textMuted }}
                  >
                    {t("count", { count: entry.count })}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
