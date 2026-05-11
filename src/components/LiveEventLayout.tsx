"use client";

import { useMemo } from "react";
import {
  useSetlistPolling,
  type ReactionCountsMap,
} from "@/hooks/useSetlistPolling";
import { useRealtimeEventChannel } from "@/hooks/useRealtimeEventChannel";
import { LAUNCH_FLAGS } from "@/lib/launchFlags";
import type { FanTop3Entry } from "@/lib/types/setlist";
import { LiveSetlist, type LiveSetlistItem } from "@/components/LiveSetlist";
import {
  EventImpressions,
  type Impression,
} from "@/components/EventImpressions";
import { EventHeader } from "@/components/EventHeader";
import { UnitsCard, type UnitsCardItem } from "@/components/event/UnitsCard";
import {
  PerformersCard,
  type PerformersCardItem,
} from "@/components/event/PerformersCard";
import {
  deriveSidebarUnitsAndPerformers,
  deriveSongsCount,
  deriveReactionsValue,
  type EventPerformerSummary,
} from "@/lib/sidebarDerivations";
import type { TrendingSong } from "@/components/TrendingSongs";
import type { ResolvedEventStatus } from "@/lib/eventStatus";

interface Props {
  // ───── Event-level static (forwarded to children unchanged) ─────
  eventId: string;
  isOngoing: boolean;
  locale: string;

  // i18n labels resolved server-side and threaded through so the
  // client re-derivations format identically to the SSR pass. Mirrors
  // the `unknownSongLabel` precedent already established by
  // `LiveSetlist` / `deriveTrendingSongs`.
  unknownArtistLabel: string;
  unknownPerformerLabel: string;
  unknownSongLabel: string;

  // Stable for the lifetime of the page — operators set the guest
  // roster before the event and don't change it during a live show.
  // No polling needed for this slice.
  eventPerformers: EventPerformerSummary[];

  // EventHeader props (event-level, never change after mount).
  status: ResolvedEventStatus;
  /**
   * D-7 open-window indicator (Wishlist + Predicted Setlist
   * visibility). Computed server-side via `isWishPredictOpen` so
   * the gate is snap-frozen for the page lifetime; client-side
   * ticking across the boundary is intentionally NOT done — see
   * `src/lib/eventTiming.ts` for the rationale. Threaded down into
   * `<LiveSetlist>` and from there to `<EventWishSection>` and
   * `<SetlistSection>`.
   */
  isWishPredictOpen: boolean;
  statusLabel: string;
  date: Date | string | null;
  startTime: Date | string | null;
  artist: { id: string; slug: string; name: string } | null;
  organizerName: string | null;
  series: { id: string; slug: string; name: string } | null;
  title: string;
  venue: string | null;
  city: string | null;

  // EventImpressions independent polling state (its own hook owns it).
  // The cursor + total are computed by the SSR fetch and threaded
  // through here so the "see older" button can render with an accurate
  // remaining count on first paint, before the first poll lands.
  initialImpressions: Impression[];
  initialImpressionsNextCursor: string | null;
  initialImpressionsTotalCount: number;

  // SSR-derived seeds. `useSetlistPolling` consumes
  // `initialItems`/`initialReactionCounts` directly; the four
  // `initialSidebar*` / `initialSongsCount` / `initialReactionsValue`
  // props are passed through to children only when polling is off
  // (upcoming/completed events) — avoids a redundant client recompute
  // that would produce the same output the server already shipped.
  initialItems: LiveSetlistItem[];
  initialReactionCounts: ReactionCountsMap;
  initialSidebarUnits: UnitsCardItem[];
  initialSidebarPerformers: PerformersCardItem[];
  initialSongsCount: number;
  initialReactionsValue: string;
  initialTrendingSongs: TrendingSong[];
  // Wishlist (Phase 1B) seed. SSR-rendered fan TOP-3 so first paint
  // shows real data, then polling refreshes the same shape via the
  // /api/setlist channel. Empty array when no fans have wished yet.
  initialFanTop3: FanTop3Entry[];
}

/**
 * Client wrapper that owns the live event page's sole
 * `useSetlistPolling` subscription and re-derives every sidebar value
 * from the same poll cycle that drives the right column.
 *
 * Why this layer exists:
 *   - Before this component, `useSetlistPolling` lived inside
 *     `LiveSetlist` and never propagated upward — the sidebar cards
 *     (`EventHeader`, `UnitsCard`, `PerformersCard`) rendered once
 *     server-side and stayed frozen for the rest of the session, so
 *     adding a song mid-show didn't tick the songs-count pill, didn't
 *     surface the new performer's pill, didn't show the new unit row.
 *   - Lifting the hook to a parent shared by both columns makes one
 *     poll cycle update both the setlist body AND the sidebar, with no
 *     double-fetch and no second polling timer.
 *   - The page (`src/app/[locale]/events/[id]/[[...slug]]/page.tsx`)
 *     stays a server component and computes the initial sidebar
 *     payloads at SSR — this wrapper accepts them as `initial*` props
 *     so first paint is byte-identical to the previous server render
 *     (SEO and crawlers see the populated sidebar without waiting for
 *     hydration).
 *
 * Trending derivation is intentionally NOT lifted — it stays inside
 * `LiveSetlist` because it's tightly setlist-scoped (the trending
 * card sits directly above the setlist card in the right column) and
 * the existing pattern there already re-derives correctly when
 * `items`/`reactionCounts` arrive as props.
 */
export function LiveEventLayout({
  eventId,
  isOngoing,
  locale,
  unknownArtistLabel,
  unknownPerformerLabel,
  unknownSongLabel,
  eventPerformers,
  status,
  isWishPredictOpen,
  statusLabel,
  date,
  startTime,
  artist,
  organizerName,
  series,
  title,
  venue,
  city,
  initialImpressions,
  initialImpressionsNextCursor,
  initialImpressionsTotalCount,
  initialItems,
  initialReactionCounts,
  initialSidebarUnits,
  initialSidebarPerformers,
  initialSongsCount,
  initialReactionsValue,
  initialTrendingSongs,
  initialFanTop3,
}: Props) {
  // Polling stays enabled for ongoing AND upcoming events: the
  // wishlist fan TOP-3 needs to update pre-show as more fans submit
  // wishes (per task spec). Setlist + reactions are stable pre-show
  // (admins enter songs as the show runs), so the extra polling on
  // upcoming events fetches a duplicate snapshot — cheap, and the
  // single-channel architecture is worth it. Polling stays off for
  // completed/cancelled events.
  const isActive = status === "ongoing" || status === "upcoming";

  // R1 Realtime cutover: branch on `LAUNCH_FLAGS.realtimeEnabled`. Both
  // hooks must always be called (rules-of-hooks), so we drive the
  // pick via the `enabled` flag — only the active hook does any
  // network work; the other returns its initial state unchanged.
  // The boolean annotation widens away the literal `false` type so
  // TypeScript keeps both branches in scope (otherwise the realtime
  // hook would be statically dead code today).
  //
  // Activation flow mirrors `confirmDbEnabled`: a single commit
  // flips the flag to `true` AND deletes the polling branch +
  // useSetlistPolling import here. The hook file stays alive as
  // R3's fallback mechanism — the activation removes only this
  // call site, not the hook itself.
  const realtimeFlag: boolean = LAUNCH_FLAGS.realtimeEnabled;
  const polled = useSetlistPolling<LiveSetlistItem>({
    eventId,
    initialItems,
    initialReactionCounts,
    initialTop3Wishes: initialFanTop3,
    locale,
    enabled: isActive && !realtimeFlag,
  });
  // Coerce startTime to a stable ISO string for the realtime hook's
  // boundary scheduler. The hook's effect deps include startTime,
  // so a Date object (fresh identity each render) would re-create
  // the channel every render — catastrophic. Same pattern as
  // <EventHeader> uses when forwarding to <EventStatusTicker>.
  //
  // Invalid-Date guard: `new Date("not-a-date").toISOString()` throws
  // RangeError. SSR is contractually expected to hand down valid
  // Dates only, but a NaN-time Date here would crash the render —
  // treat invalid as null, mirroring `nextEventStatusBoundaryDelay`'s
  // string-branch policy so the two halves of the contract align.
  const startTimeIso: string | null =
    typeof startTime === "string"
      ? startTime
      : startTime && !Number.isNaN(startTime.getTime())
        ? startTime.toISOString()
        : null;
  const realtime = useRealtimeEventChannel<LiveSetlistItem>({
    eventId,
    initialItems,
    initialReactionCounts,
    initialTop3Wishes: initialFanTop3,
    locale,
    enabled: isActive && realtimeFlag,
    startTime: startTimeIso,
  });
  const {
    items,
    reactionCounts,
    top3Wishes,
    status: polledStatus,
    lastUpdated,
  } = realtimeFlag ? realtime : polled;
  // Effective status: prefer the polled value when present, fall
  // back to the SSR-initial `status` prop. Both paths refresh
  // `polledStatus` at the right cadence to catch the
  // server-side auto-flip past startTime — without it, a user
  // with a slow device clock could keep editing past startTime
  // (their `Date.now() < startMs` even when the server says
  // ongoing). v0.10.0 smoke caught that symptom; CR #297
  // hardened the propagation.
  //
  // How `polledStatus` stays fresh, per data-source path:
  //   - Polling (`useSetlistPolling`): fetches /api/setlist every
  //     5s, polled.status reflects the server's auto-flip within
  //     ≤5s of the boundary.
  //   - Realtime (`useRealtimeEventChannel`): a boundary-scheduled
  //     setTimeout (see `nextEventStatusBoundaryDelay` and the
  //     channel-setup effect) calls fetchSnapshot at startTime +
  //     POST_BOUNDARY_BUFFER_MS, refreshing polledStatus. Without
  //     this, Realtime would only refetch on push (Path B for
  //     SetlistItem and SongWish), and a startTime crossing in a
  //     no-activity window would leave polledStatus stale —
  //     `polledStatus ?? status` would mask a fresh SSR status
  //     (refreshed by <EventStatusTicker>'s router.refresh at the
  //     same boundary) with the stale polled value.
  //   - R3 fallback: same as polling.
  const effectiveStatus: ResolvedEventStatus = polledStatus ?? status;

  // Use the SSR-rendered sidebar values until polling delivers fresh
  // data (`lastUpdated !== null`). This single gate covers two cases:
  //
  //   1. Non-ongoing events — polling is disabled, `lastUpdated` stays
  //      null forever, sidebar always renders the server's snapshot.
  //
  //   2. Ongoing events on first render — before the first poll
  //      completes, we deliberately don't recompute. Re-running
  //      `deriveReactionsValue` on the client would call
  //      `Intl.NumberFormat(locale, { notation: "compact", … })`,
  //      whose output can drift subtly between Node and browser ICU
  //      versions for the same input + locale (e.g., compact suffix
  //      spacing or rounding). The server pre-formatted the value
  //      precisely to avoid that hydration mismatch
  //      (see the original comment in `page.tsx` `reactionsValue`
  //      derivation), so we honor that until polling is the
  //      authoritative source.
  //
  // After the first successful poll, all four values re-derive from
  // the polled `items` + `reactionCounts` and keep ticking on every
  // subsequent poll — server output is no longer the source of truth.
  const { sidebarUnits, sidebarPerformers, songsCount, reactionsValue } =
    useMemo(() => {
      if (lastUpdated === null) {
        return {
          sidebarUnits: initialSidebarUnits,
          sidebarPerformers: initialSidebarPerformers,
          songsCount: initialSongsCount,
          reactionsValue: initialReactionsValue,
        };
      }
      const { units, performers } = deriveSidebarUnitsAndPerformers(
        items,
        eventPerformers,
        locale,
        unknownArtistLabel,
        unknownPerformerLabel,
      );
      return {
        sidebarUnits: units,
        sidebarPerformers: performers,
        songsCount: deriveSongsCount(items),
        reactionsValue: deriveReactionsValue(reactionCounts, locale),
      };
    }, [
      lastUpdated,
      items,
      reactionCounts,
      eventPerformers,
      locale,
      unknownArtistLabel,
      unknownPerformerLabel,
      initialSidebarUnits,
      initialSidebarPerformers,
      initialSongsCount,
      initialReactionsValue,
    ]);

  return (
    /*
      Mobile: single column (header on top, setlist + impressions below).
      Desktop (lg ≥ 1024px): 2-col grid 300px / 1fr with sticky sidebar at
      top: 72px. Grid's natural single-col on mobile means EventHeader
      renders above the main column without any extra layout branching.
    */
    <div className="lg:grid lg:grid-cols-[300px_1fr] lg:gap-6 lg:items-start">
      {/* sticky offset = Nav.tsx desktop height (56px) + 16px breathing room.
          Three sidebar cards stacked with consistent gap; flex column wraps
          the stack so sticky positioning still applies to the topmost edge. */}
      <aside className="flex flex-col gap-4 lg:sticky lg:top-[72px]">
        <EventHeader
          status={status}
          statusLabel={statusLabel}
          date={date}
          startTime={startTime}
          locale={locale}
          artist={artist}
          organizerName={organizerName}
          series={series}
          title={title}
          songsCount={songsCount}
          reactionsValue={reactionsValue}
          venue={venue}
          city={city}
        />
        <UnitsCard locale={locale} units={sidebarUnits} />
        <PerformersCard performers={sidebarPerformers} />
      </aside>

      <div className="mt-6 lg:mt-0 min-w-0">
        <LiveSetlist
          eventId={eventId}
          items={items}
          reactionCounts={reactionCounts}
          top3Wishes={top3Wishes}
          initialTrendingSongs={initialTrendingSongs}
          startTime={startTime}
          unknownSongLabel={unknownSongLabel}
          isOngoing={isOngoing}
          locale={locale}
          status={effectiveStatus}
          isWishPredictOpen={isWishPredictOpen}
          // `series.name` is already pre-resolved by the page via
          // `displayNameWithFallback(...)` for the EventHeader card.
          // Reuse for the share-card text payload; fall back to
          // `title` (the localized event title) when the event
          // doesn't belong to a series.
          seriesName={series?.name ?? title}
        />

        <EventImpressions
          eventId={eventId}
          initialImpressions={initialImpressions}
          initialNextCursor={initialImpressionsNextCursor}
          initialTotalCount={initialImpressionsTotalCount}
          isOngoing={isOngoing}
        />
      </div>
    </div>
  );
}
