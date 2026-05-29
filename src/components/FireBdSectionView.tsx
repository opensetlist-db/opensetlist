"use client";

import { useEffect } from "react";
import { trackBdSectionView } from "@/lib/analytics";

/*
 * Fires the `bd_section_view` GA4 event once on mount, then renders
 * nothing. Mounted only inside EventBdSection's rendering variants
 * (bd_announced / bd_preorder / bd_released) — never for the null
 * states or the album-less long_mid teaser, so a fired event always
 * carries a real `album_id` + a hyphenated `bd_state`.
 *
 * Mount-fire = "section rendered," not "scrolled into view";
 * IntersectionObserver-based impression tracking is Phase 3 (out of
 * scope per b10c). Dev StrictMode double-fire is acceptable (prod
 * single-mount fires once).
 */
export function FireBdSectionView(props: {
  eventId: string;
  albumId: string;
  bdState: string;
  topBonusCount: number;
}) {
  useEffect(() => {
    trackBdSectionView(props);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
