"use client";

import { useEffect } from "react";
import { trackAlbumView } from "@/lib/analytics";

/*
 * Fires the `album_view` GA4 event once on mount, then renders nothing.
 *
 * Mounted by the (server-rendered) Album detail page — a client island
 * is the minimal way to run a mount effect without turning the page
 * into a client component. All params are resolved server-side and
 * passed in already-stringified (GA4 params are string/number/boolean;
 * a raw BigInt id would throw), so this component does no data work.
 *
 * Dev StrictMode double-invokes the effect (two events); production
 * single-mount fires once — acceptable per the b10c spec (the funnel
 * baseline tolerates dev-only double counts, which never reach prod GA).
 */
export function FireAlbumView(props: {
  albumId: string;
  albumType: string;
  artistId: string;
  locale: string;
  hasAmazonListing: boolean;
}) {
  useEffect(() => {
    trackAlbumView(props);
    // Fire exactly once per mount — the album identity can't change
    // without a full remount (id is in the route), so an empty dep
    // array is correct and intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
