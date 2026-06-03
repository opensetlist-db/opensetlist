"use client";

import { useEffect } from "react";
import { trackBdSectionView } from "@/lib/analytics";

/*
 * Fires the `bd_section_view` GA4 event when its params change (incl.
 * first mount), then renders nothing. Mounted only inside
 * EventBdSection's rendering variants (bd_announced / bd_preorder /
 * bd_released) — never for the null states or the album-less long_mid
 * teaser, so a fired event always carries a real `album_id` + a
 * hyphenated `bd_state`.
 *
 * Depends on the params rather than `[]` for the same reason as
 * FireAlbumView: soft navigation between two event pages keeps this
 * client instance mounted, so an empty-dep effect would miss the second
 * event's view. The params change with the event (eventId/albumId) or
 * its BD lifecycle, re-firing then, while staying inert across
 * same-event re-renders. Mount-fire = "section rendered," not "scrolled
 * into view" (IntersectionObserver impressions are Phase 3). Dev
 * StrictMode double-fire is acceptable.
 */
export function FireBdSectionView({
  eventId,
  albumId,
  bdState,
  topBonusCount,
}: {
  eventId: string;
  albumId: string;
  bdState: string;
  topBonusCount: number;
}) {
  useEffect(() => {
    trackBdSectionView({ eventId, albumId, bdState, topBonusCount });
  }, [eventId, albumId, bdState, topBonusCount]);
  return null;
}
